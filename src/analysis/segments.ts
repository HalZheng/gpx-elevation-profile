import type { GradeBand } from '../types'

const INF = Number.POSITIVE_INFINITY

/** 与 piecewise 语义一致：首段覆盖下限之外，末段覆盖上限之外，中间空缺返回 -1 */
export function bandIndexOf(bands: GradeBand[], grade: number): number {
  const n = bands.length
  if (n === 0) return -1
  if (grade < bands[0].to) return 0
  if (grade >= bands[n - 1].from) return n - 1
  for (let i = n - 1; i >= 0; i--) {
    if (grade >= bands[i].from && grade < bands[i].to) return i
  }
  return -1
}

/**
 * 迟滞量：取各区间的典型宽度的 1/4。
 * 没有它的话，坡度在区间边界附近抖动会让颜色逐点反复横跳，图上全是碎段。
 */
export function hysteresisFor(bands: GradeBand[]): number {
  const widths = bands
    .map((b) => b.to - b.from)
    .filter((w) => isFinite(w) && w > 0)
    .sort((a, b) => a - b)
  const typical = widths.length > 0 ? widths[widths.length >> 1] : 2
  return Math.min(1, Math.max(0.15, typical * 0.25))
}

/**
 * 把逐点坡度归类到区间，用于「按坡度」着色。
 *
 * 真实骑行里坡度是一段持续的体感，不是逐秒跳变，所以这里做两件事：
 *  1. **迟滞**：只有明确越过边界（多出 hysteresis 个百分点）才换区间，
 *     避免在阈值附近反复横跳；
 *  2. **过短段合并**：把长度不足 minLengthMeters 的段并入它更长的邻居，
 *     保证每段都足够长、看得清（首尾段不受限）。
 */
export function classifyByGrade(
  grade: Float64Array,
  dist: Float64Array,
  bands: GradeBand[],
  minLengthMeters: number,
): Int16Array {
  const n = grade.length
  const keys = new Int16Array(n)
  if (bands.length === 0 || n === 0) return keys

  const sorted = [...bands].sort((a, b) => a.from - b.from)
  const h = hysteresisFor(sorted)
  const lowerOf = (k: number): number => (k === 0 ? -INF : sorted[k].from)
  const upperOf = (k: number): number => (k === sorted.length - 1 ? INF : sorted[k].to)

  keys[0] = bandIndexOf(sorted, grade[0])
  for (let i = 1; i < n; i++) {
    const cur = keys[i - 1]
    if (cur < 0) {
      keys[i] = bandIndexOf(sorted, grade[i])
      continue
    }
    const inBand = grade[i] >= lowerOf(cur) - h && grade[i] < upperOf(cur) + h
    keys[i] = inBand ? cur : bandIndexOf(sorted, grade[i])
  }

  return minLengthMeters > 0 ? mergeShortRuns(keys, dist, minLengthMeters) : keys
}

/** 连续同值段的数量 */
export function countSegments(keys: Int16Array): number {
  let count = 0
  for (let i = 0; i < keys.length; i++) {
    if (i === 0 || keys[i] !== keys[i - 1]) count++
  }
  return count
}

interface Group {
  a: number
  b: number
  key: number
}

function collectGroups(keys: Int16Array): Group[] {
  const out: Group[] = []
  let i = 0
  while (i < keys.length) {
    let j = i
    while (j + 1 < keys.length && keys[j + 1] === keys[i]) j++
    out.push({ a: i, b: j, key: keys[i] })
    i = j + 1
  }
  return out
}

/**
 * 反复把「当前最短的过短段」并入它更长的邻居，直到没有过短段。
 * 每次都挑最短的，段数严格单调递减，不会出现合并后反而更碎的情况。
 */
function mergeShortRuns(keys: Int16Array, dist: Float64Array, minLength: number): Int16Array {
  const groups = collectGroups(keys)
  const lengthOf = (g: Group): number => dist[g.b] - dist[g.a]

  let guard = groups.length * 4 + 16
  while (groups.length > 1 && guard-- > 0) {
    let pick = -1
    let shortest = INF
    for (let i = 0; i < groups.length; i++) {
      const len = lengthOf(groups[i])
      if (len < minLength && len < shortest) {
        shortest = len
        pick = i
      }
    }
    if (pick < 0) break

    const prev = pick > 0 ? groups[pick - 1] : null
    const next = pick < groups.length - 1 ? groups[pick + 1] : null
    const target = !prev ? next : !next ? prev : lengthOf(prev) >= lengthOf(next!) ? prev : next
    if (!target) break

    const short = groups[pick]
    if (target === prev) prev.b = short.b
    else target.a = short.a
    groups.splice(pick, 1)
  }

  const out = new Int16Array(keys.length)
  for (const g of groups) {
    for (let i = g.a; i <= g.b; i++) out[i] = g.key
  }
  return out
}
