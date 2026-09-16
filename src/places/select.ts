import type { Place, PlaceLabel, RawPoint } from '../types'
import { projectToPath } from '../gpx/geo'
import { kindMeta } from './meta'
import { MAX_CATCHMENT_M } from './overpass'

export interface PlaceParams {
  /** 基础纳入半径，米（各类地名再按 radiusScale 放大） */
  radius: number
  /** 沿路径的最小标注间距，米 */
  minSpacing: number
  /** 最多标注数量 */
  maxCount: number
}

/**
 * 去掉括号后缀再归并同名：「大连理工大学（西门）」→「大连理工大学」。
 * 实测同一条路上会出现 大连理工大学（东门/西门/南门）+ 主节点共 4 个同名元素，
 * 不归并就会叠成一堆重复标签。
 */
export function baseName(name: string): string {
  const s = name
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+/g, '')
    .trim()
  return s || name.trim()
}

export interface PlaceSelection {
  labels: PlaceLabel[]
  /** 通过半径筛选的候选数（同名归并前），用来说明「还有几个没标上」 */
  eligible: number
  /** 同名归并后参与竞选的候选数 */
  merged: number
  /** 起点/终点是否真的钉上了地名 */
  anchors: { start: boolean; end: boolean }
}

/** 起终点锚定窗口内的候选，额外带一个标记供后续处理 */
type Candidate = PlaceLabel & { atEnd: boolean }

/**
 * 从候选地名里挑出最终要标注的若干个。
 *
 * 四步：
 *  1. 投影到路径 → 得到「离路线多远」和「里程」，按类别半径过滤，顺带算综合得分；
 *     起点/终点附近放宽一倍半径 —— 这一带若没有更具体的路标，就退而用小区名、商场名补上。
 *  2. 同名归并（只在「沿路径位置接近」时归并，相隔很远的同名村庄各自保留）；
 *  3. **先钉住起终点**：各取窗口内得分最高的一个放进结果，避免被后面的高分地名用间距挤掉；
 *  4. 其余候选按得分从高到低贪心接受，与已接受的标注在路径上距离不足 minSpacing 的跳过。
 */
export function selectPlaceLabels(
  places: Place[],
  points: RawPoint[],
  dist: Float64Array,
  params: PlaceParams,
): PlaceSelection {
  const { radius, minSpacing, maxCount } = params
  const total = dist.length > 0 ? dist[dist.length - 1] : 0
  // 起终点锚定窗口：总长的 3%，至少 1 km
  const anchorWindow = Math.max(1000, total * 0.03)
  const scored: Candidate[] = []

  for (const p of places) {
    const meta = kindMeta(p.kind)
    // 行政中心离路线往往很远，但「确实穿过了这个区」依然有意义，所以按类别放大半径
    const base = Math.min(radius * meta.radiusScale, MAX_CATCHMENT_M)
    const proj = projectToPath(points, dist, p.lat, p.lon)
    const atEnd = proj.dist <= anchorWindow || proj.dist >= total - anchorWindow
    const catchment = atEnd ? Math.min(base * 2, MAX_CATCHMENT_M) : base
    if (proj.offset > catchment) continue

    const proximity = Math.max(0, 1 - proj.offset / catchment)
    const notability = p.notable
      ? 1
      : p.population >= 20000
        ? 0.8
        : p.population >= 5000
          ? 0.5
          : 0

    const name = baseName(p.name)
    scored.push({
      name,
      // 显示名保持完整（「凌水街道」而不是「凌水」）：街道本身就是当地人惯用的地名
      display: name,
      category: meta.category,
      kind: p.kind,
      km: proj.dist,
      offset: proj.offset,
      idx: proj.idx,
      // 权重混排：类别基准 55% + 离路线远近 35% + 知名度 10%
      score: 0.55 * meta.weight + 0.35 * proximity + 0.1 * notability,
      atEnd,
    })
  }

  // 同名归并：把同名候选按里程排序，相邻间距小于 mergeWindow 的算同一个地方，取分高的
  const mergeWindow = Math.max(1500, minSpacing)
  const byName = new Map<string, Candidate[]>()
  for (const label of scored) {
    const list = byName.get(label.name)
    if (list) list.push(label)
    else byName.set(label.name, [label])
  }

  const deduped: Candidate[] = []
  for (const list of byName.values()) {
    list.sort((a, b) => a.km - b.km)
    let cluster: Candidate[] = []
    const flush = (): void => {
      if (cluster.length === 0) return
      let top = cluster[0]
      for (const c of cluster) if (c.score > top.score) top = c
      // 只要这一簇里有一个落在起终点窗口，归并结果就继承这个身份
      top = { ...top, atEnd: cluster.some((c) => c.atEnd) }
      deduped.push(top)
      cluster = []
    }
    for (const label of list) {
      if (cluster.length > 0 && label.km - cluster[cluster.length - 1].km > mergeWindow) flush()
      cluster.push(label)
    }
    flush()
  }

  deduped.sort((a, b) => b.score - a.score || a.km - b.km)

  const accepted: Candidate[] = []
  const anchors = { start: false, end: false }

  // 先钉起终点：取窗口内得分最高的一个。这里额外按「离端点还有多远」扣分——
  // 否则会把 1.7 km 外的公园选成「起 ·」，标签挂在 1.7 km 处名不副实。
  const anchorPenalty = (c: Candidate, fromEnd: number): number =>
    c.score - (fromEnd / anchorWindow) * 0.4

  const bestIn = (fromEnd: (c: Candidate) => number, inWindow: (c: Candidate) => boolean): Candidate | undefined =>
    deduped
      .filter(inWindow)
      .sort((a, b) => anchorPenalty(b, fromEnd(b)) - anchorPenalty(a, fromEnd(a)))[0]

  const startPick = bestIn((c) => c.km, (c) => c.km <= anchorWindow)
  if (startPick) {
    startPick.anchor = 'start'
    accepted.push(startPick)
    anchors.start = true
  }
  const endPick = bestIn((c) => total - c.km, (c) => c.km >= total - anchorWindow)
  // 太短的轨迹两个窗口会重叠到同一个地方，此时只留起点锚点
  if (endPick && endPick !== startPick && Math.abs(endPick.km - (startPick?.km ?? -1e9)) >= minSpacing) {
    endPick.anchor = 'end'
    accepted.push(endPick)
    anchors.end = true
  }

  for (const c of deduped) {
    if (accepted.length >= maxCount) break
    if (c.anchor) continue
    if (accepted.some((a) => Math.abs(a.km - c.km) < minSpacing)) continue
    accepted.push(c)
  }

  const labels = accepted
    .sort((a, b) => a.km - b.km)
    .map((c) => {
      const label: PlaceLabel = {
        name: c.name,
        display:
          c.anchor === 'start' ? `起 · ${c.display}` : c.anchor === 'end' ? `终 · ${c.display}` : c.display,
        category: c.category,
        kind: c.kind,
        km: c.km,
        offset: c.offset,
        idx: c.idx,
        score: c.score,
      }
      if (c.anchor) label.anchor = c.anchor
      return label
    })

  return { labels, eligible: scored.length, merged: deduped.length, anchors }
}
