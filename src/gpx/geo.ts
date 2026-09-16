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

export interface PathProjection {
  /** 到路径（折线）的最近距离，米 */
  offset: number
  /** 投影点处的累积里程，米 */
  dist: number
  /** 投影点对应的轨迹点索引 */
  idx: number
}

/**
 * 把一个点投影到轨迹折线上，得到「离路径多远」和「投影点的里程」。
 *
 * 用于沿线的地名筛选：半径要按「点到折线」的距离算，不能按「点到采样点」算，
 * 否则弯道内侧的地名会被高估距离而漏掉；里程也要取投影点处的，直接取最近点的里程
 * 在稀疏采样时会偏出上百米。
 *
 * 实现上先用最近顶点粗筛，再在相邻几段上精算。GPS 轨迹点距通常只有几米到几十米，
 * 最近顶点必然落在最近段附近，粗筛不会漏。
 */
export function projectToPath(
  points: RawPoint[],
  dist: Float64Array,
  lat: number,
  lon: number,
): PathProjection {
  const n = points.length
  if (n === 0) return { offset: Infinity, dist: 0, idx: 0 }
  if (n === 1) return { offset: haversine(points[0].lat, points[0].lon, lat, lon), dist: 0, idx: 0 }

  // 以查询点为原点做局部等距圆柱投影，几公里内足够精确
  const kx = (Math.PI / 180) * EARTH_R * Math.cos((lat * Math.PI) / 180)
  const ky = (Math.PI / 180) * EARTH_R

  let bi = 0
  let bestD2 = Infinity
  for (let i = 0; i < n; i++) {
    const dx = (points[i].lon - lon) * kx
    const dy = (points[i].lat - lat) * ky
    const d2 = dx * dx + dy * dy
    if (d2 < bestD2) {
      bestD2 = d2
      bi = i
    }
  }

  let bestOffset = Math.sqrt(bestD2)
  let bestDist = dist[bi]
  let bestIdx = bi

  const lo = Math.max(0, bi - 4)
  const hi = Math.min(n - 2, bi + 4)
  for (let i = lo; i <= hi; i++) {
    const ax = (points[i].lon - lon) * kx
    const ay = (points[i].lat - lat) * ky
    const bx = (points[i + 1].lon - lon) * kx
    const by = (points[i + 1].lat - lat) * ky
    const vx = bx - ax
    const vy = by - ay
    const len2 = vx * vx + vy * vy
    let t = len2 > 0 ? -(ax * vx + ay * vy) / len2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const cx = ax + vx * t
    const cy = ay + vy * t
    const off = Math.sqrt(cx * cx + cy * cy)
    if (off < bestOffset) {
      bestOffset = off
      bestDist = dist[i] + (dist[i + 1] - dist[i]) * t
      bestIdx = t > 0.5 ? i + 1 : i
    }
  }

  return { offset: bestOffset, dist: bestDist, idx: bestIdx }
}
