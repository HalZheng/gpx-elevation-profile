import type { Place, PlaceCategory, RawPoint } from '../types'
import { hasKind, kindMeta } from './meta'

/**
 * 沿线地名数据源：OpenStreetMap 的 Overpass API。
 *
 * 关键设计 —— **一条轨迹只发一次请求**：
 * 地名不做逐点反查，而是一次性把轨迹外扩范围内的候选地名全部取回，
 * 之后的「半径过滤 / 里程投影 / 择优去重」全在本地算。
 * 因此调整半径、间距等参数不会重新联网。
 *
 * 为了让这一点成立，bbox 的外扩量取固定值 PAD_M（不随半径滑杆变化），
 * 否则拖动滑杆就会换缓存 key、触发新请求。
 */

// 实测（同一时刻）：api.de 高负载下会 504，osm.ch 1.15 s 返回且 CORS 开放，
// kumi.systems 偶发连不上。按当前可用性排序，重试时轮换。
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

/** bbox 外扩距离（米）：足够覆盖行政中心离路线较远的情况 */
export const PAD_M = 8000

/** 单个地名的纳入半径上限（米），与 PAD_M 呼应 */
export const MAX_CATCHMENT_M = PAD_M

const FETCH_TIMEOUT_MS = 18_000

/** 最多试几轮。公共 Overpass 在高负载下会返回 504，换实例 + 退避重试基本都能过 */
const ATTEMPTS = 4

/**
 * 重试间隔。Overpass 的 504 多半是「并发槽位被占满」，官方建议退避几十秒，
 * 但用户是在等着的，所以取 2 / 5 / 10 s 这个折中：足以吃掉瞬时抖动，
 * 且面板会显示「第 N/M 次尝试」，不会让人以为卡死。
 */
const RETRY_DELAYS_MS = [2000, 5000, 10000]

/**
 * 整轮取数的总预算。全部尝试都失败时要在界面上给出错误 + 重试入口，
 * 不能让它一直停在「正在取回…」——所以再加一道总时长护栏。
 */
const TOTAL_BUDGET_MS = 70_000

export interface PlaceFetchResult {
  places: Place[]
  /** 供缓存与排查使用的 bbox 字符串 */
  bbox: string
  /** 原始元素数（含无名、未分类的） */
  rawCount: number
  endpoint: string
  elapsedMs: number
  /** network=本次联网；memory=本次会话缓存；store=完全命中；reuse=复用了更大范围的缓存 */
  source: 'network' | 'memory' | 'store' | 'reuse'
}

const cache = new Map<string, Place[]>()

interface FetchMeta {
  endpoint: string
  elapsedMs: number
}

const metaOf = new Map<string, FetchMeta>()
const inflight = new Map<string, Promise<Place[]>>()

/* ------------------------- 跨会话缓存（localStorage） -------------------------
 * Overpass 是公共免费实例，同一条轨迹反复刷新没必要重复请求。
 * 落在 localStorage 里还有第二个好处：撞上 504 / 429 时，之前取过的轨迹依然能用。
 */

// 键名带版本号：**改动 buildQuery 的取数范围时必须一起升版**，
// 否则用户浏览器里那份旧范围的缓存会被继续复用最长 7 天
const STORE_KEY = 'ep-places-cache-v2'
const STORE_TTL_MS = 7 * 24 * 3600 * 1000
const STORE_MAX_ENTRIES = 8
const STORE_MAX_BYTES = 400 * 1024

interface StoreEntry {
  t: number
  places: Place[]
  endpoint: string
  elapsedMs: number
}

function readStore(): Record<string, StoreEntry> {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StoreEntry>) : {}
  } catch {
    return {}
  }
}

function writeStore(store: Record<string, StoreEntry>): void {
  // 只保留最近的若干条并限制总体积，避免把 localStorage 撑爆
  const entries = Object.entries(store)
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, STORE_MAX_ENTRIES)
  const out: Record<string, StoreEntry> = {}
  let bytes = 0
  for (const [key, entry] of entries) {
    const size = JSON.stringify(entry).length
    if (bytes + size > STORE_MAX_BYTES) continue
    bytes += size
    out[key] = entry
  }
  if (bytes === 0) return
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(out))
  } catch {
    /* 隐私模式或容量不足：静默放弃持久缓存 */
  }
}

function parseBbox(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(',').map(Number)
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null
  return parts as [number, number, number, number]
}

/**
 * 找一个「范围完全包含目标 bbox」的缓存条目。
 * 同一条轨迹换成长途/短途时 bbox 会变，但常常是小范围落在大范围里；
 * 大范围那次请求拿到的候选池对小范围同样适用，直接复用可以完全省掉一次联网
 * ——在公共实例集体抽风的时段，这往往就是「有没有地名」的分水岭。
 */
function findSuperset(store: Record<string, StoreEntry>, bbox: string): StoreEntry | null {
  const target = parseBbox(bbox)
  if (!target) return null
  const [s, w, n, e] = target
  let best: StoreEntry | null = null
  let bestArea = Infinity
  for (const [key, entry] of Object.entries(store)) {
    if (Date.now() - entry.t > STORE_TTL_MS) continue
    if (!Array.isArray(entry.places)) continue
    const box = parseBbox(key)
    if (!box) continue
    const [ks, kw, kn, ke] = box
    if (ks > s || kw > w || kn < n || ke < e) continue
    const area = (kn - ks) * (ke - kw)
    if (area < bestArea) {
      bestArea = area
      best = entry
    }
  }
  return best
}

/** 轨迹的地理外框，向外扩 PAD_M */
export function paddedBbox(points: RawPoint[]): string {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  for (const p of points) {
    if (!isFinite(p.lat) || !isFinite(p.lon)) continue
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
  }
  if (!isFinite(minLat)) return '0,0,0,0'
  const latC = Math.max(-85, Math.min(85, (minLat + maxLat) / 2))
  const dLat = PAD_M / 111_320
  const dLon = PAD_M / (111_320 * Math.max(0.05, Math.cos((latC * Math.PI) / 180)))
  const f = (v: number): number => Math.round(v * 1e4) / 1e4
  return [f(minLat - dLat), f(minLon - dLon), f(maxLat + dLat), f(maxLon + dLon)].join(',')
}

/**
 * 一次请求拿全量候选。`node` 用于行政/聚落，`nwr` 让景区、校园、公园、小区这类
 * 面要素也能取到中心点。带 `["name"]` 的 clause 是**服务端就滤掉无名要素**——
 * `landuse=residential` 这类面在城里成百上千，不带名字的只会白白撑大响应。
 */
function buildQuery(bbox: string): string {
  return `[out:json][timeout:25];
(
  node["place"~"^(city|district|town|suburb|quarter|neighbourhood|village|hamlet|locality)$"](${bbox});
  nwr["tourism"~"^(attraction|viewpoint|museum|theme_park|zoo|garden)$"]["name"](${bbox});
  nwr["amenity"~"^(university|college|school|marketplace)$"]["name"](${bbox});
  nwr["leisure"~"^(park|stadium|nature_reserve)$"]["name"](${bbox});
  nwr["shop"~"^(mall|department_store)$"]["name"](${bbox});
  nwr["landuse"~"^(residential|retail)$"]["name"](${bbox});
);
out tags center;`
}

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

/** 从标签里挑一个最适合显示的名字：优先中文名 */
function pickName(tags: Record<string, string>): string | null {
  const raw = tags['name:zh'] || tags.name || tags['name:zh-Hans']
  if (!raw || !raw.trim()) return null
  // 纯英文/编号的兜底名（如 "view point"）不展示，噪音大于信息
  return raw.trim()
}

/** 找出这个元素是靠哪个标签入选的，进而决定类别与权重 */
function pickKind(tags: Record<string, string>): string | null {
  if (hasKind(tags.place)) return tags.place
  for (const key of ['tourism', 'amenity', 'leisure', 'shop', 'landuse'] as const) {
    if (hasKind(tags[key])) return tags[key]
  }
  return null
}

function toPlace(el: OverpassElement): Place | null {
  const tags = el.tags
  if (!tags) return null
  const kind = pickKind(tags)
  if (!kind) return null
  const name = pickName(tags)
  if (!name) return null
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (!isFinite(lat as number) || !isFinite(lon as number)) return null

  const pop = Number(tags.population)
  const meta = kindMeta(kind)
  return {
    id: el.id,
    name,
    category: meta.category as PlaceCategory,
    kind,
    lat: lat as number,
    lon: lon as number,
    notable: Boolean(tags.wikidata || tags.wikipedia),
    population: isFinite(pop) ? pop : NaN,
  }
}

interface OverpassResponse {
  elements?: OverpassElement[]
  osm3s?: { timestamp_osm_base?: string }
}

/** 「连响应头都没拿到」的错误（超时 / 网络层失败），与「服务端返回了错误码」区分开 */
interface NoResponseError extends Error {
  noResponse: true
}

const markNoResponse = (message: string): NoResponseError =>
  Object.assign(new Error(message), { noResponse: true as const })

const isNoResponse = (err: unknown): boolean =>
  err instanceof Error && (err as Partial<NoResponseError>).noResponse === true

/**
 * 校验响应是不是来自一个「数据库已就绪」的实例。
 * 关键坑：数据库还在装载的实例会返回形如 "117042" 的假时间戳，
 * 并对**任何**查询都回 HTTP 200 + 空结果。若不拦下来，就会被当成
 * 「这一带没有地名」——比报错更糟，因为它是对的假象。
 * （缺失这段字段的实例按健康处理，只拦已知的坏签名）
 */
function assertHealthy(json: OverpassResponse): void {
  const ts = json.osm3s?.timestamp_osm_base
  if (ts === undefined) return
  if (!/^\d{4}-\d{2}-\d{2}T/.test(ts)) throw new Error('镜像数据库未就绪')
}

async function requestOnce(endpoint: string, bbox: string): Promise<Place[]> {
  const controller = new AbortController()
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, FETCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(buildQuery(bbox)),
      signal: controller.signal,
    })
  } catch {
    throw markNoResponse(timedOut ? '请求超时' : '网络不可达')
  } finally {
    window.clearTimeout(timer)
  }

  if (!res.ok) throw new Error(`镜像返回 HTTP ${res.status}`)

  let json: OverpassResponse
  try {
    json = (await res.json()) as OverpassResponse
  } catch {
    throw new Error('返回内容不是合法 JSON')
  }
  assertHealthy(json)

  const out: Place[] = []
  for (const el of json.elements ?? []) {
    const place = toPlace(el)
    if (place) out.push(place)
  }
  return out
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/**
 * 取轨迹周边的候选地名。同 bbox 命中缓存或复用进行中的请求，
 * 因此反复切换轨迹、拖动半径都不会重复联网。
 */
export async function fetchPlaces(
  points: RawPoint[],
  onAttempt?: (info: { attempt: number; total: number; endpoint: string }) => void,
): Promise<PlaceFetchResult> {
  const bbox = paddedBbox(points)

  const hit = cache.get(bbox)
  if (hit) {
    const meta = metaOf.get(bbox)
    return {
      places: hit,
      bbox,
      rawCount: hit.length,
      endpoint: meta?.endpoint ?? '本次会话缓存',
      elapsedMs: meta?.elapsedMs ?? 0,
      source: 'memory',
    }
  }

  // 跨会话缓存：只要没过期就直接用，不再打扰公共实例
  const store = readStore()
  const stored = store[bbox]
  if (stored && Date.now() - stored.t < STORE_TTL_MS && Array.isArray(stored.places)) {
    cache.set(bbox, stored.places)
    metaOf.set(bbox, { endpoint: stored.endpoint, elapsedMs: stored.elapsedMs })
    return {
      places: stored.places,
      bbox,
      rawCount: stored.places.length,
      endpoint: stored.endpoint,
      elapsedMs: 0,
      source: 'store',
    }
  }

  // 没有完全命中，但可能有「范围更大、包含这一片」的缓存，同样够用
  const superset = findSuperset(store, bbox)
  if (superset) {
    cache.set(bbox, superset.places)
    metaOf.set(bbox, { endpoint: superset.endpoint, elapsedMs: 0 })
    return {
      places: superset.places,
      bbox,
      rawCount: superset.places.length,
      endpoint: superset.endpoint,
      elapsedMs: 0,
      source: 'reuse',
    }
  }

  const t0 = performance.now()
  let task = inflight.get(bbox)
  if (!task) {
    task = (async () => {
      let lastErr: unknown = null
      let noResponse = 0
      const deadline = t0 + TOTAL_BUDGET_MS
      // 端点轮换重试：公共实例偶发 504 / 超时，换一个或等一会儿再来一次基本都能成
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        if (attempt > 0 && performance.now() > deadline) break
        const ep = ENDPOINTS[attempt % ENDPOINTS.length]
        onAttempt?.({
          attempt: attempt + 1,
          total: ATTEMPTS,
          endpoint: ep.replace(/^https?:\/\/([^/]+).*$/, '$1'),
        })
        try {
          const places = await requestOnce(ep, bbox)
          metaOf.set(bbox, {
            endpoint: ep.replace(/^https?:\/\/([^/]+).*$/, '$1'),
            elapsedMs: Math.round(performance.now() - t0),
          })
          return places
        } catch (err) {
          lastErr = err
          if (isNoResponse(err)) {
            noResponse++
            // 连续两次连响应头都拿不到，基本可以断定是本机网络/代理的问题，
            // 再换镜像也是白等——提前收尾，把「重新获取」交给用户
            if (noResponse >= 2) break
          }
          if (attempt < ATTEMPTS - 1) await delay(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)])
        }
      }
      if (isNoResponse(lastErr)) throw new Error('地名服务无响应，已重试多次')
      throw lastErr instanceof Error ? lastErr : new Error('所有镜像均不可用')
    })()
    inflight.set(bbox, task)
    task.finally(() => inflight.delete(bbox)).catch(() => undefined)
  }

  const places = await task
  cache.set(bbox, places)
  const meta = metaOf.get(bbox)
  const nextStore = readStore()
  nextStore[bbox] = {
    t: Date.now(),
    places,
    endpoint: meta?.endpoint ?? 'overpass',
    elapsedMs: meta?.elapsedMs ?? 0,
  }
  writeStore(nextStore)
  return {
    places,
    bbox,
    rawCount: places.length,
    endpoint: meta?.endpoint ?? 'overpass',
    elapsedMs: meta?.elapsedMs ?? Math.round(performance.now() - t0),
    source: 'network',
  }
}
