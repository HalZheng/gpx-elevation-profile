import type { Descent, DescentParams } from '../types'

export const DEFAULT_DESCENT_PARAMS: DescentParams = {
  maxGrade: -1.5,
  minLength: 400,
  minDrop: 15,
  bridgeGap: 200,
  bridgeRise: 12,
}

/**
 * 下坡识别与段内极速点定位。
 *
 * 识别逻辑与 `detectClimbs` 完全对称：以滚动坡度找出「持续在下降」的连续区段，
 * 再跨越短暂的平路 / 缓上（间隔 ≤ bridgeGap 且中途爬升 ≤ bridgeRise），
 * 合并后平均坡度仍需足够陡（≤ maxGrade），最后按最小长度与最小累计下降过滤。
 *
 * 与爬坡不同的是「极速点」：每段内找出滚动速度最高的那个点，
 * 它是这段下坡真正值得看的数据（骑得快不快、在哪里最快）。
 * 没有时间数据时速度全为 NaN，此时 peakIdx 记 -1，调用方据此跳过标注。
 */
export function detectDescents(
  dist: Float64Array,
  ele: Float64Array,
  grade: Float64Array,
  time: Float64Array,
  speed: Float64Array,
  params: DescentParams,
): Descent[] {
  const n = dist.length
  if (n < 3) return []

  // --- 1. 标记下坡点，切成初始区段 ---
  const runs: Array<[number, number]> = []
  let i = 0
  while (i < n) {
    if (!(grade[i] <= params.maxGrade)) {
      i++
      continue
    }
    let j = i
    while (j + 1 < n && grade[j + 1] <= params.maxGrade) j++
    runs.push([i, j])
    i = j + 1
  }
  if (runs.length === 0) return []

  // --- 2. 合并：跨越短暂的平路 / 缓上 ---
  const merged: Array<[number, number]> = []
  let cur = runs[0]
  for (let k = 1; k < runs.length; k++) {
    const next = runs[k]
    const gapStart = cur[1]
    const gapEnd = next[0]

    let highestInGap = ele[gapStart]
    for (let p = gapStart; p <= gapEnd; p++) {
      if (ele[p] > highestInGap) highestInGap = ele[p]
    }
    const gapLength = dist[gapEnd] - dist[gapStart]
    const gapRise = highestInGap - ele[gapStart]

    const mergedLength = dist[next[1]] - dist[cur[0]]
    const mergedNet = ele[next[1]] - ele[cur[0]]
    const mergedAvg = mergedLength > 0 ? (mergedNet / mergedLength) * 100 : 0

    const bridgeable =
      gapLength <= params.bridgeGap &&
      gapRise <= params.bridgeRise &&
      mergedAvg <= params.maxGrade

    if (bridgeable) {
      cur = [cur[0], next[1]]
    } else {
      merged.push(cur)
      cur = next
    }
  }
  merged.push(cur)

  // --- 3. 统计、过滤，并找出段内极速点 ---
  const descents: Descent[] = []
  for (const [s, e] of merged) {
    if (e <= s) continue

    const length = dist[e] - dist[s]
    if (length < params.minLength) continue

    let drop = 0
    for (let p = s + 1; p <= e; p++) {
      const d = ele[p - 1] - ele[p]
      if (d > 0) drop += d
    }
    if (drop < params.minDrop) continue

    let steepest = Infinity
    let peakIdx = -1
    let peakSpeed = -Infinity
    for (let p = s; p <= e; p++) {
      if (grade[p] < steepest) steepest = grade[p]
      const v = speed[p]
      if (isFinite(v) && v > peakSpeed) {
        peakSpeed = v
        peakIdx = p
      }
    }

    const netDrop = ele[s] - ele[e]
    const avgGrade = -(netDrop / length) * 100

    descents.push({
      startIdx: s,
      endIdx: e,
      startDist: dist[s],
      endDist: dist[e],
      length,
      drop,
      netDrop,
      avgGrade,
      maxGrade: isFinite(steepest) ? steepest : 0,
      startTime: time[s],
      duration: isFinite(time[e]) && isFinite(time[s]) ? time[e] - time[s] : NaN,
      peakIdx,
      peakSpeed: peakIdx >= 0 ? peakSpeed : NaN,
      peakDist: peakIdx >= 0 ? dist[peakIdx] : NaN,
      peakTime: peakIdx >= 0 ? time[peakIdx] : NaN,
    })
  }

  return descents
}
