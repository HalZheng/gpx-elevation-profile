import type { Climb, ClimbParams } from '../types'

export const DEFAULT_CLIMB_PARAMS: ClimbParams = {
  minGrade: 2,
  minLength: 300,
  minGain: 20,
  bridgeGap: 200,
  bridgeDrop: 15,
}

/** Strava 爬坡分级阈值（评分 = 长度 m × 平均坡度整数 %） */
export const STRAVA_TIERS: Array<{ min: number; category: 'HC' | '1' | '2' | '3' | '4' }> = [
  { min: 80000, category: 'HC' },
  { min: 64000, category: '1' },
  { min: 32000, category: '2' },
  { min: 16000, category: '3' },
  { min: 8000, category: '4' },
]

/** 参与分级所需的最低平均坡度（Strava 规则） */
export const STRAVA_MIN_GRADE = 3

/**
 * 爬坡难度色阶：越难越暖。
 * 刻意避开蓝色系 —— 蓝色留给「非爬坡段」的底色主高亮色，
 * 否则 Cat 4 会被误读成普通路段。
 */
export const CATEGORY_COLORS: Record<string, string> = {
  none: '#7C8DA6',
  '4': '#35C29A',
  '3': '#E8C44A',
  '2': '#F0871F',
  '1': '#E5484D',
  HC: '#9E1B34',
}

/** 取某等级的颜色，未分级爬坡用 none 色 */
export function climbColor(category: Climb['category']): string {
  return CATEGORY_COLORS[category ?? 'none'] ?? CATEGORY_COLORS.none
}

/**
 * 长坡识别。
 *
 * 思路：以滚动坡度为判据找出「持续在爬升」的连续区段，再对这些区段做两轮合并——
 *   1) 跨越短暂的平路 / 缓下（间隔 ≤ bridgeGap 且中途下降 ≤ bridgeDrop）；
 *   2) 合并后平均坡度不得低于 minGrade，避免把整条起伏路拉成一个大坡。
 * 最后按最小长度、最小累计爬升过滤，并按 Strava 规则评分分级。
 */
export function detectClimbs(
  dist: Float64Array,
  ele: Float64Array,
  grade: Float64Array,
  time: Float64Array,
  params: ClimbParams,
): Climb[] {
  const n = dist.length
  if (n < 3) return []

  // --- 1. 标记爬升点，切成初始区段 ---
  const runs: Array<[number, number]> = []
  let i = 0
  while (i < n) {
    if (!(grade[i] >= params.minGrade)) {
      i++
      continue
    }
    let j = i
    while (j + 1 < n && grade[j + 1] >= params.minGrade) j++
    runs.push([i, j])
    i = j + 1
  }
  if (runs.length === 0) return []

  // --- 2. 合并 ---
  const merged: Array<[number, number]> = []
  let cur = runs[0]
  for (let k = 1; k < runs.length; k++) {
    const next = runs[k]
    const gapStart = cur[1]
    const gapEnd = next[0]

    let lowestInGap = ele[gapStart]
    for (let p = gapStart; p <= gapEnd; p++) {
      if (ele[p] < lowestInGap) lowestInGap = ele[p]
    }
    const gapLength = dist[gapEnd] - dist[gapStart]
    const gapDrop = ele[gapStart] - lowestInGap

    const mergedLength = dist[next[1]] - dist[cur[0]]
    const mergedNet = ele[next[1]] - ele[cur[0]]
    const mergedAvg = mergedLength > 0 ? (mergedNet / mergedLength) * 100 : 0

    const bridgeable =
      gapLength <= params.bridgeGap &&
      gapDrop <= params.bridgeDrop &&
      mergedAvg >= params.minGrade

    if (bridgeable) {
      cur = [cur[0], next[1]]
    } else {
      merged.push(cur)
      cur = next
    }
  }
  merged.push(cur)

  // --- 3. 统计与过滤 ---
  const climbs: Climb[] = []
  for (const [s, e] of merged) {
    if (e <= s) continue

    const length = dist[e] - dist[s]
    if (length < params.minLength) continue

    let gain = 0
    let maxGrade = -Infinity
    for (let p = s + 1; p <= e; p++) {
      const d = ele[p] - ele[p - 1]
      if (d > 0) gain += d
    }
    for (let p = s; p <= e; p++) {
      if (grade[p] > maxGrade) maxGrade = grade[p]
    }

    if (gain < params.minGain) continue

    const netGain = ele[e] - ele[s]
    const avgGrade = (netGain / length) * 100
    const gradeInt = Math.max(0, Math.round(avgGrade))
    const score = Math.round(length) * gradeInt

    let category: Climb['category'] = null
    if (avgGrade >= STRAVA_MIN_GRADE) {
      const tier = STRAVA_TIERS.find((t) => score >= t.min)
      if (tier) category = tier.category
    }

    climbs.push({
      startIdx: s,
      endIdx: e,
      startDist: dist[s],
      endDist: dist[e],
      length,
      gain,
      netGain,
      avgGrade,
      maxGrade: isFinite(maxGrade) ? maxGrade : 0,
      score,
      category,
      startTime: time[s],
      duration: isFinite(time[e]) && isFinite(time[s]) ? time[e] - time[s] : NaN,
    })
  }

  return climbs
}

export function categoryLabel(category: Climb['category']): string {
  if (!category) return '未分级'
  if (category === 'HC') return 'HC'
  return `Cat ${category}`
}
