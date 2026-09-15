export interface YDomain {
  min: number
  max: number
  interval: number
}

const STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000]

/** 把区间对齐到「好看」的刻度上 */
export function niceDomain(min: number, max: number, targetTicks = 5): YDomain {
  if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 100, interval: 20 }
  if (max - min < 1e-6) {
    return { min: min - 5, max: max + 5, interval: 2 }
  }

  const rawStep = (max - min) / Math.max(targetTicks, 2)
  let step = STEPS[STEPS.length - 1]
  for (const s of STEPS) {
    if (s >= rawStep) {
      step = s
      break
    }
  }

  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  return { min: round(lo), max: round(hi), interval: step }
}

/** 首尾各留一点内边距，避免曲线贴着边框 */
function pad(min: number, max: number): [number, number] {
  const range = max - min
  const p = Math.max(range * 0.12, 1.5)
  return [min - p, max + p]
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

/**
 * 计算当前可视横轴窗口内的纵轴范围 —— 缩放后纵轴重新自适应，
 * 这是「不同距离尺度都能看清海拔起伏」的关键。
 */
export function visibleYDomain(
  x: Float64Array,
  series: Float64Array[],
  startPct: number,
  endPct: number,
): YDomain {
  const n = x.length
  if (n === 0) return { min: 0, max: 100, interval: 20 }

  const x0 = x[0]
  const x1 = x[n - 1]
  const span = x1 - x0
  const vx0 = x0 + (span * startPct) / 100
  const vx1 = x0 + (span * endPct) / 100

  let i0 = lowerBound(x, vx0)
  let i1 = upperBound(x, vx1)
  // 左右各多含一个点，曲线两端不会突然断掉
  i0 = Math.max(0, i0 - 1)
  i1 = Math.min(n - 1, i1 + 1)
  if (i1 < i0) i1 = i0

  let min = Infinity
  let max = -Infinity
  for (const arr of series) {
    for (let i = i0; i <= i1; i++) {
      const v = arr[i]
      if (!isFinite(v)) continue
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (min === Infinity) return { min: 0, max: 100, interval: 20 }

  const [pmin, pmax] = pad(min, max)
  // 数据本身没有负海拔时，不要为了凑整把纵轴拉到 0 以下：
  // 既浪费一半画布高度，也会让「海拔」看起来像有负值。clamp 到 0 后再 nice 化，
  // 落到 0 的刻度上是自然的（0 / 20 / 40 …）。
  const lower = min >= 0 ? Math.max(0, pmin) : pmin
  return niceDomain(lower, pmax)
}

function lowerBound(x: Float64Array, target: number): number {
  let lo = 0
  let hi = x.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (x[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function upperBound(x: Float64Array, target: number): number {
  let lo = 0
  let hi = x.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (x[mid] > target) hi = mid - 1
    else lo = mid
  }
  return lo
}
