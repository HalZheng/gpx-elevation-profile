import type { PlaceCategory } from '../types'

export interface KindMeta {
  /** tooltip 里显示的中文类别名 */
  label: string
  category: PlaceCategory
  /** 「知名度」基准权重 0–1，参与择优打分 */
  weight: number
  /**
   * 半径倍数。行政中心/街道驻地是个「点」，但它代表的面域很大：
   * 骑行穿过甘井子区时，区政府可能在十几公里外。所以区县/市按大倍数纳入，
   * 村庄和兴趣点这类「点状」地名按 1 倍。
   */
  radiusScale: number
}

/** 按 OSM 原始标签值索引的类别元数据 */
export const KIND_META: Record<string, KindMeta> = {
  // 行政区划。街道本身是很有辨识度的地名（「凌水街道」「南关岭街道」当地人都这么叫），
  // 权重保持原始水平，不做回避；只有「更著名的地标」才靠权重自然赢过它。
  city: { label: '市', category: 'admin', weight: 1.0, radiusScale: 8 },
  district: { label: '区县', category: 'admin', weight: 0.98, radiusScale: 6 },
  town: { label: '镇', category: 'admin', weight: 0.88, radiusScale: 3 },
  suburb: { label: '街道', category: 'admin', weight: 0.82, radiusScale: 2.2 },
  quarter: { label: '片区', category: 'admin', weight: 0.6, radiusScale: 1.2 },
  neighbourhood: { label: '社区', category: 'admin', weight: 0.55, radiusScale: 1.2 },

  // 聚落
  village: { label: '村庄', category: 'settlement', weight: 0.66, radiusScale: 1 },
  hamlet: { label: '小村', category: 'settlement', weight: 0.6, radiusScale: 1 },
  locality: { label: '地段', category: 'settlement', weight: 0.45, radiusScale: 1 },

  // 兴趣点 —— 真正著名的地标（景点、高校）权重高于街道，有它们时自然会被选中
  attraction: { label: '景点', category: 'poi', weight: 0.92, radiusScale: 1 },
  theme_park: { label: '主题公园', category: 'poi', weight: 0.86, radiusScale: 1 },
  zoo: { label: '动物园', category: 'poi', weight: 0.84, radiusScale: 1 },
  museum: { label: '博物馆', category: 'poi', weight: 0.8, radiusScale: 1 },
  viewpoint: { label: '观景点', category: 'poi', weight: 0.78, radiusScale: 1 },
  garden: { label: '园林', category: 'poi', weight: 0.66, radiusScale: 1 },
  nature_reserve: { label: '自然保护区', category: 'poi', weight: 0.72, radiusScale: 1 },
  park: { label: '公园', category: 'poi', weight: 0.7, radiusScale: 1 },
  stadium: { label: '体育场', category: 'poi', weight: 0.68, radiusScale: 1 },
  university: { label: '高校', category: 'poi', weight: 0.9, radiusScale: 1 },
  college: { label: '学院', category: 'poi', weight: 0.72, radiusScale: 1 },
  mall: { label: '商场', category: 'poi', weight: 0.8, radiusScale: 1.2 },
  department_store: { label: '百货', category: 'poi', weight: 0.6, radiusScale: 1.2 },

  // 下面几类是「填充位」：权重刻意排在街道之下，
  // 只在附近确实没有更具体的街道 / 村庄 / 地标时，才用来把这一段或起终点补上
  retail: { label: '商圈', category: 'poi', weight: 0.62, radiusScale: 1.6 },
  school: { label: '学校', category: 'poi', weight: 0.6, radiusScale: 1 },
  marketplace: { label: '市场', category: 'poi', weight: 0.58, radiusScale: 1.2 },
  residential: { label: '小区', category: 'poi', weight: 0.56, radiusScale: 1.6 },
}

/**
 * 三类地名的标记色。刻意避开坡度区间与爬坡等级已占用的蓝 / 青 / 琥珀 / 橙 / 红，
 * 整体落在紫→品红一段，让「地名」一眼就能和「坡度」区分开。
 */
export const PLACE_COLOR: Record<PlaceCategory, string> = {
  admin: '#6C4FD8',
  settlement: '#8E7BE8',
  poi: '#C4519F',
}

export function kindLabel(kind: string): string {
  return KIND_META[kind]?.label ?? '地名'
}

/**
 * 更贴切的类别名：OSM 里「沙河口区」「普兰店区」被标成 place=city，
 * 直接显示「市」会明显不对。行政区划与聚落类按名称后缀纠正，兴趣点类不动
 * （否则「XX区商场」这类名字会被改错）。
 * 顺序有讲究：先长后短，「社区」必须排在「区」前面。
 */
const SUFFIX_LABELS: Array<[string, string]> = [
  ['社区', '社区'],
  ['街道', '街道'],
  ['区', '区县'],
  ['县', '县'],
  ['市', '市'],
  ['镇', '镇'],
  ['乡', '乡'],
  ['村', '村庄'],
  ['屯', '村庄'],
]

export function displayKind(kind: string, name: string): string {
  const meta = kindMeta(kind)
  if (meta.category === 'admin' || meta.category === 'settlement') {
    for (const [suffix, label] of SUFFIX_LABELS) {
      if (name.endsWith(suffix)) return label
    }
  }
  return meta.label
}

/** 该 OSM 标签值是否是我们认识的地名类型 */
export function hasKind(kind: string | undefined): boolean {
  return !!kind && kind in KIND_META
}

export function kindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? { label: '地名', category: 'poi', weight: 0.5, radiusScale: 1 }
}
