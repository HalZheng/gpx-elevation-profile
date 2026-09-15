import type { Summary } from '../types'

/** 累计爬升/下降采用的滞回阈值（米），用于抑制残余噪声累积 */
const HYSTERESIS = 1.0

/** 忽略轨迹首尾各多少米，避免窗口不足导致的假极值 */
const EDGE_TRIM = 30

export interface SummaryInput {
  dist: Float64Array
  time: Float64Array
  ele: Float64Array
  grade: Float64Array
  speed: Float64Array
  hr: Float64Array
  cad: Float64Array
}

export function computeSummary(input: SummaryInput): Summary {
  const { dist, time, ele, grade, speed, hr, cad } = input
  const n = ele.length
  if (n === 0) {
    return {
      distance: 0,
      gain: 0,
      loss: 0,
      minEle: 0,
      maxEle: 0,
      maxGrade: 0,
      avgGrade: 0,
      duration: 0,
      avgSpeed: 0,
      maxSpeed: 0,
      avgHr: null,
      avgCad: null,
      hrMax: null,
      cadMax: null,
    }
  }

  // --- 爬升 / 下降（滞回，避免小抖动累加） ---
  let gain = 0
  let loss = 0
  let ref = ele[0]
  let minEle = ele[0]
  let maxEle = ele[0]
  for (let i = 1; i < n; i++) {
    const e = ele[i]
    if (e < minEle) minEle = e
    if (e > maxEle) maxEle = e
    const d = e - ref
    if (d >= HYSTERESIS) {
      gain += d
      ref = e
    } else if (d <= -HYSTERESIS) {
      loss += -d
      ref = e
    }
  }

  const distance = dist[n - 1]

  // --- 坡度极值（剔除首尾窗口不足区域） ---
  let maxGrade = 0
  for (let i = 0; i < n; i++) {
    if (dist[i] < EDGE_TRIM || dist[i] > distance - EDGE_TRIM) continue
    const g = grade[i]
    if (isFinite(g) && g > maxGrade) maxGrade = g
  }
  if (maxGrade === 0) {
    for (let i = 0; i < n; i++) maxGrade = Math.max(maxGrade, grade[i] || 0)
  }

  // --- 时长与速度 ---
  const startTime = firstFinite(time)
  const endTime = lastFinite(time)
  const duration = endTime > startTime ? endTime - startTime : 0
  const avgSpeed = duration > 0 ? distance / duration : 0

  let maxSpeed = 0
  for (let i = 0; i < n; i++) {
    if (dist[i] < EDGE_TRIM || dist[i] > distance - EDGE_TRIM) continue
    const v = speed[i]
    if (isFinite(v) && v > maxSpeed) maxSpeed = v
  }

  // --- 心率 / 踏频 ---
  const hrStats = meanAndMax(hr, (v) => v >= 30 && v <= 240)
  const cadStats = meanAndMax(cad, (v) => v > 0 && v <= 250)

  return {
    distance,
    gain,
    loss,
    minEle,
    maxEle,
    maxGrade,
    avgGrade: distance > 0 ? (gain / distance) * 100 : 0,
    duration,
    avgSpeed,
    maxSpeed,
    avgHr: hrStats ? hrStats.mean : null,
    hrMax: hrStats ? hrStats.max : null,
    avgCad: cadStats ? cadStats.mean : null,
    cadMax: cadStats ? cadStats.max : null,
  }
}

function meanAndMax(
  values: Float64Array,
  accept: (v: number) => boolean,
): { mean: number; max: number } | null {
  let sum = 0
  let count = 0
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!isFinite(v) || !accept(v)) continue
    sum += v
    count++
    if (v > max) max = v
  }
  if (count === 0) return null
  return { mean: sum / count, max }
}

function firstFinite(values: Float64Array): number {
  for (let i = 0; i < values.length; i++) {
    if (isFinite(values[i])) return values[i]
  }
  return NaN
}

function lastFinite(values: Float64Array): number {
  for (let i = values.length - 1; i >= 0; i--) {
    if (isFinite(values[i])) return values[i]
  }
  return NaN
}
