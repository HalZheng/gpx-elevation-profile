/** 单个轨迹点（缺失的数据统一用 NaN 表示） */
export interface RawPoint {
  lat: number
  lon: number
  ele: number
  /** epoch 毫秒，缺失为 NaN */
  time: number
  /** 心率 bpm，缺失为 NaN */
  hr: number
  /** 踏频 rpm，缺失为 NaN */
  cad: number
}

export interface Track {
  name: string
  points: RawPoint[]
  /** 每个 trkseg 的起始点索引，用于计算距离时跳过段间跳变 */
  segStarts: number[]
  /** 是否含有效海拔（路线规划类文件可能没有 <ele>） */
  hasEle: boolean
  hasTime: boolean
  hasHr: boolean
  hasCad: boolean
  /** 原始文件大小（字节） */
  bytes: number
}

/** 与轨迹点一一对应的派生序列 */
export interface TrackSeries {
  /** 累积距离，米 */
  dist: Float64Array
  /** 相对起始时间，秒；无时间数据时全为 NaN */
  time: Float64Array
  /** 原始海拔，米 */
  eleRaw: Float64Array
  /** 校准海拔（已对齐到全部点），未校准时为 null */
  eleCal: Float64Array | null
  /** 速度，m/s */
  speed: Float64Array
  /** 心率 bpm，无数据为 NaN */
  hr: Float64Array
  /** 踏频 rpm，无数据为 NaN */
  cad: Float64Array
}

export interface SmoothSettings {
  method: 'none' | 'ma' | 'median' | 'median-ma'
  windowMeters: number
  gradeWindowMeters: number
}

/** 坡度着色区间 */
export interface GradeBand {
  from: number
  to: number
  color: string
}

/**
 * 折线标注方式 —— 三种互斥显示，不共存：
 *  off   只画一条高亮折线 + 同色渐变填充
 *  grade 按逐点瞬时坡度分段着色
 *  climb 按爬坡路段及其 Strava 等级分段着色
 */
export type AnnotateMode = 'off' | 'grade' | 'climb'

export interface ClimbParams {
  /** 判定为「在爬升」的最小坡度 % */
  minGrade: number
  /** 最小爬坡长度 m */
  minLength: number
  /** 最小累计爬升 m */
  minGain: number
  /** 合并两段爬坡的最大间隔距离 m */
  bridgeGap: number
  /** 合并时允许的最大中途下降 m */
  bridgeDrop: number
}

export interface Climb {
  startIdx: number
  endIdx: number
  /** 起止累积距离 m */
  startDist: number
  endDist: number
  /** 长度 m */
  length: number
  /** 累计爬升 m */
  gain: number
  /** 净爬升 m */
  netGain: number
  /** 平均坡度 %（净爬升 / 长度） */
  avgGrade: number
  /** 最大坡度 % */
  maxGrade: number
  /** Strava 评分 = 长度(m) × 平均坡度整数% */
  score: number
  /** Strava 分级：'HC' | '1' | '2' | '3' | '4' | null */
  category: 'HC' | '1' | '2' | '3' | '4' | null
  /** 起始时间（秒，相对起点），无时间数据为 NaN */
  startTime: number
  duration: number
}

export interface Summary {
  distance: number
  gain: number
  loss: number
  minEle: number
  maxEle: number
  maxGrade: number
  avgGrade: number
  duration: number
  avgSpeed: number
  maxSpeed: number
  avgHr: number | null
  avgCad: number | null
  hrMax: number | null
  cadMax: number | null
}

/**
 * 沿线地名的三大类 —— 只用于配色与图例分组，
 * 更细的「村 / 街道 / 景点 / 高校」由 `kind`（OSM 原始标签值）承载。
 */
export type PlaceCategory = 'admin' | 'settlement' | 'poi'

/** 从 Overpass 归一化出来的候选地名 */
export interface Place {
  /** OSM 元素 id，仅用于去重与调试 */
  id: number
  name: string
  category: PlaceCategory
  /** OSM 原始标签值，如 village / suburb / attraction / mall */
  kind: string
  lat: number
  lon: number
  /** 带 wikipedia / wikidata 标签，视为「知名」 */
  notable: boolean
  /** 人口数（仅 place 类有），未知为 NaN */
  population: number
}

/** 投影到路径上、并通过择优筛选的地名标注 */
export interface PlaceLabel {
  /** 归并用的完整名称 */
  name: string
  /** 图上显示的文本：行政后缀已剥离，起终点锚点还带「起 · / 终 ·」前缀 */
  display: string
  category: PlaceCategory
  kind: string
  /** 沿路径的里程，米（由投影点算出，不是取最近轨迹点的里程） */
  km: number
  /** 到路径的最近距离，米 */
  offset: number
  /** 投影点对应的轨迹点索引，用于取横轴坐标与海拔 */
  idx: number
  /** 综合得分，保留下来便于调参与排查 */
  score: number
  /** 起点/终点锚点。起终点一定会有标注（除非附近确实没有任何地名） */
  anchor?: 'start' | 'end'
}
