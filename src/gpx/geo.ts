import type { RawPoint } from '../types'

const EARTH_R = 6371008.8

/** 两点球面距离，米 */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180
  const p1 = lat1 * toRad
  const p2 = lat2 * toRad
  const dp = (lat2 - lat1) * toRad
  const dl = (lon2 - lon1) * toRad
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2)
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** 累积距离（米），段与段之间不累加 */
export function computeDistance(points: RawPoint[], segStarts: number[]): Float64Array {
  const n = points.length
  const out = new Float64Array(n)
  const segStartSet = new Set(segStarts)
  let acc = 0
  for (let i = 0; i < n; i++) {
    if (i > 0 && !segStartSet.has(i)) {
      const a = points[i - 1]
      const b = points[i]
      acc += haversine(a.lat, a.lon, b.lat, b.lon)
    }
    out[i] = acc
  }
  return out
}

/** 相对起点的秒数，缺失为 NaN */
export function computeElapsed(points: RawPoint[]): Float64Array {
  const n = points.length
  const out = new Float64Array(n).fill(NaN)
  let base = NaN
  for (let i = 0; i < n; i++) {
    const t = points[i].time
    if (!isFinite(t)) continue
    if (!isFinite(base)) base = t
    out[i] = (t - base) / 1000
  }
  return out
}

/**
 * 滚动坡度：以每个点为中心、给定距离窗口做两端高程差分。
 * 双指针实现，整体 O(n)。两端窗口不足时沿用前值。
 */
export function rollingGrade(
  dist: Float64Array,
  ele: Float64Array,
  windowMeters: number,
): Float64Array {
  const n = dist.length
  const out = new Float64Array(n)
  if (n === 0) return out
  const half = Math.max(windowMeters, 2) / 2
  let lo = 0
  let hi = 0
  for (let i = 0; i < n; i++) {
    while (lo < i && dist[i] - dist[lo] > half) lo++
    if (hi < i) hi = i
    while (hi + 1 < n && dist[hi + 1] - dist[i] <= half) hi++
    const span = dist[hi] - dist[lo]
    if (span >= 4) {
      const g = ((ele[hi] - ele[lo]) / span) * 100
      out[i] = Math.max(-45, Math.min(45, g))
    } else {
      out[i] = i > 0 ? out[i - 1] : 0
    }
  }
  return out
}

/** 滚动速度（m/s），时间窗口 */
export function rollingSpeed(
  dist: Float64Array,
  time: Float64Array,
  windowSec: number,
): Float64Array {
  const n = dist.length
  const out = new Float64Array(n).fill(NaN)
  if (n === 0) return out
  const half = Math.max(windowSec, 1) / 2
  let lo = 0
  let hi = 0
  for (let i = 0; i < n; i++) {
    if (!isFinite(time[i])) continue
    while (lo < i && (!isFinite(time[lo]) || time[i] - time[lo] > half)) lo++
    if (hi < i) hi = i
    while (hi + 1 < n && isFinite(time[hi + 1]) && time[hi + 1] - time[i] <= half) hi++
    const dt = time[hi] - time[lo]
    if (dt > 0.4) {
      const v = (dist[hi] - dist[lo]) / dt
      out[i] = Math.max(0, Math.min(35, v))
    }
  }
  return out
}

/** 极值安全取值：忽略 NaN */
export function finiteRange(values: Float64Array): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (min === Infinity) return [0, 0]
  return [min, max]
}
