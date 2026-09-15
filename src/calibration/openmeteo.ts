import type { RawPoint } from '../types'

const ENDPOINT = 'https://api.open-meteo.com/v1/elevation'
/** 接口单次最多接受 100 个坐标 */
const BATCH_SIZE = 100

/**
 * Open-Meteo 免费额度按「坐标个数」计费，不是按请求次数：
 * 600 次/分、5000 次/时、10000 次/日。一次 100 坐标的请求 = 100 次调用。
 * 实测：连发 6 批（600 坐标）后第 7 批必定 429 Minutely API request limit exceeded。
 * 这里留 10% 余量，避免与同 IP 的其他使用者撞车。
 */
const COORD_BUDGET_PER_MIN = 540
const WINDOW_MS = 60_000
/** 窗口释放后再多等一会儿，避开服务端窗口的时间对齐误差 */
const WINDOW_MARGIN_MS = 1_500
/** 单批请求的重试次数（含 429 与网络错误） */
const MAX_RETRY = 3

export interface CalibrationResult {
  /** 已对齐到全部轨迹点的校准海拔，米 */
  ele: Float64Array
  /** 实际请求的采样点数 */
  sampleCount: number
  /** 采样间隔，米 */
  interval: number
  /** 实际发出的请求次数 */
  requestCount: number
  /** 因限流等待的总时长，毫秒 */
  waitedMs: number
  source: string
}

export interface CalibrateProgress {
  /** 已完成的采样点数 */
  done: number
  /** 采样点总数 */
  total: number
  /** 本次进度更新所处的阶段 */
  phase: 'fetch' | 'wait'
  /** 因限流还需等待的毫秒数（phase 为 wait 时有意义） */
  waitMs: number
}

export interface CalibrateOptions {
  /** 采样间隔，米 */
  intervalMeters: number
  signal?: AbortSignal
  onProgress?: (progress: CalibrateProgress) => void
}

/**
 * 用 Open-Meteo Elevation API（Copernicus DEM GLO-90）按经纬度获取地形海拔。
 * 实现要点：
 *  - 按距离间隔重采样，避免把 12000 个点全部打出去
 *  - 每批 100 个坐标，串行 + 全局坐标配额限流，对公共接口友好
 *  - 429 时按官方提示等待窗口释放后重试，而不是立刻重打
 *  - 结果按距离线性插值回全部轨迹点，保证与图表横轴严格对齐
 */
export async function calibrateElevation(
  points: RawPoint[],
  dist: Float64Array,
  options: CalibrateOptions,
): Promise<CalibrationResult> {
  const total = points.length
  if (total < 2) throw new Error('轨迹点不足，无法校准')

  // --- 1. 按距离重采样 ---
  const sampleIdx: number[] = [0]
  let lastDist = dist[0]
  for (let i = 1; i < total - 1; i++) {
    if (dist[i] - lastDist >= options.intervalMeters) {
      sampleIdx.push(i)
      lastDist = dist[i]
    }
  }
  if (sampleIdx[sampleIdx.length - 1] !== total - 1) sampleIdx.push(total - 1)

  // --- 2. 分批请求（带坐标配额） ---
  const limiter = getLimiter()
  const sampled = new Float64Array(sampleIdx.length)
  let requestCount = 0
  let waitedMs = 0

  for (let start = 0; start < sampleIdx.length; start += BATCH_SIZE) {
    throwIfAborted(options.signal)
    const chunk = sampleIdx.slice(start, start + BATCH_SIZE)

    // 配额不足时先等待窗口释放，并把等待状态透传给界面
    const wait = await limiter.acquire(chunk.length, (ms) => {
      options.onProgress?.({
        done: Math.min(start, sampleIdx.length),
        total: sampleIdx.length,
        phase: 'wait',
        waitMs: ms,
      })
    })
    if (wait > 0) {
      waitedMs += wait
      throwIfAborted(options.signal)
    }

    const lats = chunk.map((i) => points[i].lat.toFixed(6)).join(',')
    const lons = chunk.map((i) => points[i].lon.toFixed(6)).join(',')
    const url = `${ENDPOINT}?latitude=${encodeURIComponent(lats)}&longitude=${encodeURIComponent(lons)}`

    const res = await fetchElevations(url, limiter, options.signal)
    requestCount++
    waitedMs += res.waitedMs

    const values = res.values
    if (values.length !== chunk.length) {
      throw new Error(
        `海拔接口返回的坐标数量不一致（期望 ${chunk.length}，实际 ${values.length}）`,
      )
    }
    for (let k = 0; k < values.length; k++) sampled[start + k] = values[k]

    options.onProgress?.({
      done: Math.min(start + BATCH_SIZE, sampleIdx.length),
      total: sampleIdx.length,
      phase: 'fetch',
      waitMs: 0,
    })
  }

  // --- 3. 线性插值回全部点 ---
  const ele = new Float64Array(total)
  let cursor = 0
  for (let i = 0; i < total; i++) {
    while (cursor < sampleIdx.length - 1 && sampleIdx[cursor + 1] < i) cursor++

    if (i <= sampleIdx[0]) {
      ele[i] = sampled[0]
      continue
    }
    if (i >= sampleIdx[sampleIdx.length - 1]) {
      ele[i] = sampled[sampled.length - 1]
      continue
    }

    const a = sampleIdx[cursor]
    const b = sampleIdx[cursor + 1]
    if (b === a) {
      ele[i] = sampled[cursor]
      continue
    }
    const t = (i - a) / (b - a)
    ele[i] = sampled[cursor] * (1 - t) + sampled[cursor + 1] * t
  }

  return {
    ele,
    sampleCount: sampleIdx.length,
    interval: options.intervalMeters,
    requestCount,
    waitedMs,
    source: 'Open-Meteo · Copernicus DEM GLO-90',
  }
}

/* ---------------------------------------------------------------- 采样间隔 */

/** 采样间隔的下限：DEM 本身是 90 m 网格，比这更密只是插值，不会带来新地形信息 */
export const MIN_MEANINGFUL_INTERVAL = 90
/** 自适应模式的目标采样点数，一次校准大致落在单个限流窗口内（540 坐标） */
const AUTO_TARGET_POINTS = 500

export type CalIntervalChoice = 'auto' | number

/**
 * 把界面上的选择解析成实际采样间隔（米）。
 * auto 模式按轨迹总长度取间隔，使采样点数落在单窗口预算内，
 * 于是长轨迹不再撞 600 次/分的限流墙。
 */
export function resolveCalInterval(
  choice: CalIntervalChoice,
  totalMeters: number,
): number {
  if (choice !== 'auto') return Math.max(1, choice)
  if (!isFinite(totalMeters) || totalMeters <= 0) return MIN_MEANINGFUL_INTERVAL

  const raw = totalMeters / AUTO_TARGET_POINTS
  const clamped = Math.min(Math.max(raw, MIN_MEANINGFUL_INTERVAL), 500)
  // 取整到 10 m，避免出现 147 这类零碎数值
  return Math.max(MIN_MEANINGFUL_INTERVAL, Math.round(clamped / 10) * 10)
}

/** 预估算一次校准会消耗多少坐标与请求，供界面提示 */
export function estimateCalibration(
  totalMeters: number,
  intervalMeters: number,
): { points: number; requests: number; estimatedWaitMs: number } {
  const points = Math.max(1, Math.floor(totalMeters / Math.max(1, intervalMeters)) + 1)
  const requests = Math.ceil(points / BATCH_SIZE)
  // 单窗口能容纳则无需等待；否则按窗口数估算（实测与串行节流节奏吻合）
  const windows = Math.ceil(points / COORD_BUDGET_PER_MIN)
  const estimatedWaitMs = points <= COORD_BUDGET_PER_MIN ? 0 : windows * WINDOW_MS
  return { points, requests, estimatedWaitMs }
}

/* ---------------------------------------------------------------- 限流器 */

/**
 * 滑动窗口坐标配额。限流按「坐标个数」算，所以 acquire 传的是本批坐标数。
 * 所有校准共用同一个实例：同一 IP 的额度是全局的，分实例计数会互相不知道。
 */
class CoordinateRateLimiter {
  /** 窗口内已消耗的配额，{时间戳, 坐标数} */
  private spent: { t: number; n: number }[] = []
  /** 串行化 acquire，避免并发调用各自看到过期的窗口状态 */
  private tail: Promise<void> = Promise.resolve()

  async acquire(n: number, onWait?: (ms: number) => void): Promise<number> {
    let waited = 0
    const run = this.tail.then(async () => {
      for (;;) {
        const now = Date.now()
        this.prune(now)
        const used = this.spent.reduce((s, e) => s + e.n, 0)

        if (used + n <= COORD_BUDGET_PER_MIN || this.spent.length === 0) {
          this.spent.push({ t: now, n })
          return
        }

        // 等到最早的一笔记录滑出窗口
        const oldest = this.spent[0]
        const ms = Math.max(200, oldest.t + WINDOW_MS + WINDOW_MARGIN_MS - now)
        onWait?.(ms)
        await delay(ms)
        waited += ms
      }
    })
    // 让后续 acquire 排队等待本次完成
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    await run
    return waited
  }

  /** 收到 429：说明服务端窗口此刻已被打满，按「现在用掉整窗口」记账 */
  penalize(): void {
    this.spent = [{ t: Date.now(), n: COORD_BUDGET_PER_MIN }]
  }

  private prune(now: number): void {
    this.spent = this.spent.filter((e) => now - e.t < WINDOW_MS)
  }
}

let limiterSingleton: CoordinateRateLimiter | null = null
function getLimiter(): CoordinateRateLimiter {
  if (!limiterSingleton) limiterSingleton = new CoordinateRateLimiter()
  return limiterSingleton
}

/* ---------------------------------------------------------------- 请求 */

async function fetchElevations(
  url: string,
  limiter: CoordinateRateLimiter,
  signal?: AbortSignal,
): Promise<{ values: number[]; waitedMs: number }> {
  let lastError: unknown = null
  let waitedMs = 0

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    throwIfAborted(signal)
    try {
      const res = await fetch(url, { signal })
      if (!res.ok) {
        if (res.status === 429) {
          // 服务端窗口已满：记满配额，等它滑出后再试
          limiter.penalize()
          lastError = new Error(
            '请求频率超出 Open-Meteo 免费额度（600 次/分，按坐标个数计）',
          )
          if (attempt < MAX_RETRY) {
            const ms = retryAfterMs(res) ?? WINDOW_MS + WINDOW_MARGIN_MS
            waitedMs += ms
            await delay(ms)
            continue
          }
          throw lastError
        }
        if (res.status >= 500 && attempt < MAX_RETRY) {
          lastError = new Error(`海拔接口返回 ${res.status}`)
          await delay(500 * (attempt + 1))
          continue
        }
        throw new Error(`海拔接口返回 ${res.status}`)
      }

      const json = (await res.json()) as { elevation?: number[]; reason?: string }
      if (json.reason) throw new Error(json.reason)
      if (!Array.isArray(json.elevation)) throw new Error('海拔接口返回格式异常')
      return {
        values: json.elevation.map((v) =>
          typeof v === 'number' && isFinite(v) ? v : NaN,
        ),
        waitedMs,
      }
    } catch (err) {
      if (isAbort(err)) throw err
      lastError = err
      if (attempt < MAX_RETRY) await delay(400 * (attempt + 1))
    }
  }

  throw new Error(
    `获取校准海拔失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('retry-after')
  if (!raw) return null
  const sec = Number(raw)
  if (isFinite(sec) && sec > 0) return sec * 1000
  const at = Date.parse(raw)
  if (!Number.isNaN(at)) return Math.max(0, at - Date.now())
  return null
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
