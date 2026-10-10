import type { AnnotateMode, Climb, Descent, GradeBand, PlaceLabel } from '../types'
import { climbColor } from '../analysis/climbs'
import { PLACE_COLOR } from '../places/meta'
import * as fmt from '../format'
import { hexToRgbString, rgba, type ChartTheme } from './theme'
import type { YDomain } from './scale'

/** 下坡极速标注的专属色：蓝（主线）与橙（爬坡）之外另起一色，避免与分级色混淆 */
export const DESCENT_COLOR = '#12B0C8'

export interface BuildInput {
  theme: ChartTheme
  xMode: 'dist' | 'time'
  /** 横轴值：距离 km 或 时间分钟 */
  x: Float64Array
  ele: Float64Array
  /** 「按坡度」模式下预计算好的逐点区间索引（已含迟滞与过短段合并），其它模式为 null */
  gradeKeys: Int16Array | null
  /** 对比模式下的原始海拔曲线 */
  rawEle: Float64Array | null
  /** 三选一的标注方式 */
  annotate: AnnotateMode
  /** annotate === 'grade' 时生效的坡度区间 */
  bands: GradeBand[]
  /** annotate === 'climb' 时生效的爬坡路段 */
  climbs: Climb[]
  /** 要标注极速的下坡段（已由调用方按数量上限筛选） */
  descents: Descent[]
  /** 择优后的沿线地名标注 */
  places: PlaceLabel[]
  zoom: { start: number; end: number }
  y: YDomain
  tooltipFormatter: (dataIndex: number) => string
  tickFormatter: (value: number) => string
}

type Series = Record<string, unknown>

interface ColorEntry {
  color: string
  data: Array<[number, number] | null>
}

export function buildChartOption(input: BuildInput): Record<string, unknown> {
  const {
    theme,
    xMode,
    x,
    ele,
    rawEle,
    annotate,
    bands,
    gradeKeys,
    climbs,
    descents,
    places,
    zoom,
    y,
    tooltipFormatter,
    tickFormatter,
  } = input

  const n = x.length
  const entries = buildEntries({ x, ele, annotate, bands, gradeKeys, climbs, theme })

  const series: Series[] = []
  // 先把所有填充画完，再画所有描边 —— 保证填充永远不会盖住别的线段
  entries.forEach((entry, i) => series.push(fillSeries(entry, i, theme)))
  entries.forEach((entry, i) => series.push(lineSeries(entry, i, theme)))

  // 对比曲线（原始海拔），画在最上层
  if (rawEle) {
    const rawData = new Array<[number, number]>(n)
    for (let i = 0; i < n; i++) rawData[i] = [x[i], rawEle[i]]
    series.push({
      name: 'raw',
      type: 'line',
      data: rawData,
      dimensions: ['x', 'ele'],
      showSymbol: false,
      animation: false,
      z: 5,
      silent: true,
      lineStyle: { width: 1.5, color: theme.raw, type: [5, 4], cap: 'round' },
      emphasis: { disabled: true },
      tooltip: { show: false },
    })
  }

  // 地名标注画在最上层
  const placeLayer = placeSeries(places, x, ele, y, theme)
  if (placeLayer) series.push(placeLayer)

  // 下坡极速标注再压一层：数量少、信息密度高，允许盖住地名
  const descentLayer = descentSeries(descents, x, ele, y, theme)
  if (descentLayer) series.push(descentLayer)

  return {
    animation: false,
    backgroundColor: 'transparent',
    // top 留出 44px：地名标签浮在曲线上方，空间不够会在顶部被裁掉
    grid: { left: 6, right: 26, top: 44, bottom: 66, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      borderWidth: 1,
      padding: [10, 12],
      textStyle: { color: theme.text, fontSize: 12 },
      extraCssText:
        'border-radius:11px; box-shadow:0 12px 34px rgba(0,0,0,.22); backdrop-filter:blur(10px);',
      axisPointer: {
        // cross：纵向 + 横向两条标尺，便于同时读出「距离」和「海拔」
        type: 'cross',
        snap: true,
        lineStyle: { color: theme.accent, width: 1, type: [4, 4] },
        crossStyle: { color: theme.accent, width: 1, type: [4, 4] },
        label: { show: false },
      },
      formatter: (params: unknown) => {
        const first = Array.isArray(params) ? params[0] : params
        const idx = (first as { dataIndex?: number } | undefined)?.dataIndex
        return typeof idx === 'number' ? tooltipFormatter(idx) : ''
      },
      position: (point: number[], _p: unknown, _dom: unknown, _rect: unknown, size: unknown) => {
        const s = size as { viewSize: [number, number]; contentSize: [number, number] }
        const [px, py] = point
        const [cw, ch] = s.contentSize
        const [vw, vh] = s.viewSize
        let left = px + 16
        if (left + cw > vw - 8) left = px - cw - 16
        if (left < 8) left = 8
        let top = py - ch / 2
        top = Math.max(8, Math.min(top, vh - ch - 8))
        return [left, top]
      },
    },
    xAxis: {
      type: 'value',
      min: x[0],
      max: x[n - 1],
      name: xMode === 'dist' ? '距离 km' : '时间',
      nameLocation: 'end',
      nameGap: 10,
      nameTextStyle: { color: theme.chartText, fontSize: 11, align: 'right' },
      axisLine: { lineStyle: { color: theme.axis, width: 1 } },
      // 横轴标尺要有刻度，才能一眼看出量程被切成了几段
      axisTick: {
        show: true,
        length: 5,
        lineStyle: { color: theme.axis, width: 1 },
      },
      axisLabel: {
        color: theme.chartText,
        fontSize: 11,
        fontWeight: 500,
        hideOverlap: true,
        showMaxLabel: false,
        margin: 10,
        formatter: (v: number) => tickFormatter(v),
      },
      splitLine: { show: false },
      axisPointer: {
        show: true,
        snap: true,
        lineStyle: { color: theme.accent, width: 1, type: [4, 4] },
        label: pointerLabel(theme, (v) => tickFormatter(v)),
      },
    },
    yAxis: {
      type: 'value',
      min: y.min,
      max: y.max,
      interval: y.interval,
      name: '海拔 m',
      nameLocation: 'end',
      nameGap: 14,
      nameTextStyle: {
        color: theme.chartText,
        fontSize: 11,
        align: 'left',
        verticalAlign: 'bottom',
      },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.chartText, fontSize: 11, fontWeight: 500, margin: 8 },
      splitLine: { lineStyle: { color: theme.grid, width: 1 } },
      axisPointer: {
        show: true,
        // 横向标尺只是「水平读数辅助线」：从光标位置横着对到左边的海拔刻度，
        // 精确数值由 tooltip 提供。这里刻意不挂数值徽标 —— 实测 ECharts 的 snap
        // 对值轴无效（指针取的是光标高度而非数据值），挂上就会出现
        // 「标尺写着 66 m、tooltip 写着 20 m」的自相矛盾。
        label: { show: false },
        lineStyle: { color: theme.accent, width: 1, type: [4, 4] },
      },
    },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        start: zoom.start,
        end: zoom.end,
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        throttle: 24,
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        start: zoom.start,
        end: zoom.end,
        height: 24,
        bottom: 14,
        brushSelect: false,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        fillerColor: rgba(theme.accentRgb, 0.09),
        dataBackground: {
          lineStyle: { color: theme.raw, width: 1, opacity: 0.7 },
          areaStyle: { color: rgba(theme.accentRgb, 0.1) },
        },
        selectedDataBackground: {
          lineStyle: { color: theme.accent, width: 1 },
          areaStyle: { color: rgba(theme.accentRgb, 0.18) },
        },
        handleStyle: {
          color: theme.surface,
          borderColor: theme.accent,
          borderWidth: 1.5,
          shadowBlur: 0,
        },
        moveHandleSize: 0,
        textStyle: { color: theme.chartText, fontSize: 10 },
      },
    ],
    series,
  }
}

/* ------------------------------------------------------------ 沿线地名 */

/**
 * 地名用「散点系列」画，而不是 markPoint —— 只有系列级别的 `labelLayout`
 * 才支持 `hideOverlap`，markPoint 不吃这个配置，密集时标签会叠成一片。
 *
 * 每个地名画一个小圆点落在曲线上，标签浮在点的上/下方；因为高处没有空间，
 * 海拔落在纵轴上部 22% 的地名把标签翻到点下方。
 */
function placeSeries(
  labels: PlaceLabel[],
  x: Float64Array,
  ele: Float64Array,
  y: YDomain,
  theme: ChartTheme,
): Series | null {
  if (labels.length === 0) return null
  const span = Math.max(1e-6, y.max - y.min)
  const surfaceRgb = hexToRgbString(theme.surface)
  const x0 = x[0]
  const xSpan = x[x.length - 1] - x0 || 1

  const data = labels.map((p) => {
    const color = PLACE_COLOR[p.category]
    const pointX = x[p.idx]
    const high = (ele[p.idx] - y.min) / span > 0.78
    // 贴着网格左右边缘的地名，标签往网格内倒，否则胶囊会被裁掉一半
    const t = (pointX - x0) / xSpan
    const align = t < 0.02 ? 'left' : t > 0.98 ? 'right' : 'center'
    const isAnchor = p.anchor !== undefined
    return {
      name: p.display,
      value: [pointX, ele[p.idx]],
      // 点击放大时用得上：dataIndex 与轨迹点索引不是一回事
      idx: p.idx,
      itemStyle: {
        color,
        borderColor: theme.surface,
        borderWidth: isAnchor ? 1.8 : 1.4,
      },
      label: {
        position: high ? 'bottom' : 'top',
        distance: 5,
        align,
        formatter: p.display,
        color: theme.text,
        fontSize: 11,
        fontWeight: 600,
        padding: [3, 6],
        borderRadius: 5,
        // 胶囊底：地名的背后常是渐变填充，不加底会看不清
        backgroundColor: rgba(surfaceRgb, theme.isDark ? 0.78 : 0.88),
        borderColor: rgba(hexToRgbString(color), isAnchor ? 0.9 : 0.55),
        borderWidth: 1,
      },
    }
  })

  return {
    name: 'places',
    type: 'scatter',
    data,
    symbolSize: 5,
    z: 9,
    animation: false,
    label: { show: true },
    // hideOverlap 负责「实在挤不下就隐藏」，moveOverlap:'shiftY' 让它先尝试上下错位——
    // 否则只会看到一个孤零零的圆点却没有名字
    labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
    emphasis: { disabled: true },
    tooltip: { show: false },
  }
}

/* ---------------------------------------------------------- 下坡极速 */

/**
 * 下坡极速标注：在每段下坡的速度最高点落一个倒三角，标签写极速与均坡。
 *
 * 与地名同样用散点系列（而不是 markPoint）——只有系列级 `labelLayout` 支持
 * `hideOverlap`，多段下坡的标签挤在一起时能自动让位。标签默认浮在点上方，
 * 海拔落在纵轴上部时翻到下方，否则会被网格顶边裁掉。
 */
function descentSeries(
  descents: Descent[],
  x: Float64Array,
  ele: Float64Array,
  y: YDomain,
  theme: ChartTheme,
): Series | null {
  const marks = descents.filter((d) => d.peakIdx >= 0 && isFinite(d.peakSpeed))
  if (marks.length === 0) return null

  const span = Math.max(1e-6, y.max - y.min)
  const surfaceRgb = hexToRgbString(theme.surface)
  const descentRgb = hexToRgbString(DESCENT_COLOR)
  const x0 = x[0]
  const xSpan = x[x.length - 1] - x0 || 1

  const data = marks.map((d) => {
    const pointX = x[d.peakIdx]
    const high = (ele[d.peakIdx] - y.min) / span > 0.72
    // 贴着网格左右边缘的点，标签往网格内倒，否则会被裁掉一半
    const t = (pointX - x0) / xSpan
    const align = t < 0.06 ? 'left' : t > 0.94 ? 'right' : 'center'
    return {
      name: '下坡极速',
      value: [pointX, ele[d.peakIdx]],
      // 点击放大时用得上：dataIndex 与轨迹点索引不是一回事
      idx: d.peakIdx,
      itemStyle: {
        color: DESCENT_COLOR,
        borderColor: theme.surface,
        borderWidth: 1.6,
      },
      label: {
        position: high ? 'bottom' : 'top',
        distance: 6,
        align,
        formatter: `{v|${fmt.fmtSpeed(d.peakSpeed)}}{u| km/h}\n{g|均坡 ${fmt.fmtSignedPct(d.avgGrade)}}`,
        rich: {
          v: { color: theme.text, fontSize: 12, fontWeight: 700, lineHeight: 15 },
          u: { color: theme.muted, fontSize: 9, fontWeight: 600, lineHeight: 15 },
          g: { color: DESCENT_COLOR, fontSize: 10, fontWeight: 700, lineHeight: 13 },
        },
        padding: [3, 6],
        borderRadius: 5,
        // 胶囊底：下坡处背后常是渐变填充，不加底会看不清
        backgroundColor: rgba(surfaceRgb, theme.isDark ? 0.78 : 0.88),
        borderColor: rgba(descentRgb, 0.62),
        borderWidth: 1,
      },
    }
  })

  return {
    name: 'descents',
    type: 'scatter',
    data,
    // 倒三角：一眼认出「这是下坡」
    symbol: 'path://M1,1 L15,1 L8,15 Z',
    symbolSize: 13,
    z: 10,
    animation: false,
    label: { show: true },
    labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
    emphasis: { disabled: true },
    tooltip: { show: false },
  }
}

/* ------------------------------------------------------------ 坐标轴指针 */
/**
 * 十字标尺气泡的统一外观。两套主题下都要满足「accent 底 + 高对比文字」：
 * 明亮模式的 accent 是深蓝（配白字），暗色模式是亮蓝（配近黑字）。
 */
function pointerLabel(
  theme: ChartTheme,
  format: (value: number) => string,
): Record<string, unknown> {
  return {
    show: true,
    formatter: (p: { value: number }) => format(p.value),
    backgroundColor: theme.accent,
    color: theme.isDark ? '#04121f' : '#ffffff',
    fontSize: 11,
    fontWeight: 600,
    padding: [4, 7],
    borderRadius: 5,
    shadowBlur: 0,
  }
}

/* ------------------------------------------------------------ 颜色分组 */

/**
 * 三种标注方式共用同一条渲染路径：把轨迹点按「颜色键」切段，
 * 每个颜色一条填充 + 一条描边。off 模式退化成单色一条。
 */
function buildEntries(args: {
  x: Float64Array
  ele: Float64Array
  annotate: AnnotateMode
  bands: GradeBand[]
  gradeKeys: Int16Array | null
  climbs: Climb[]
  theme: ChartTheme
}): ColorEntry[] {
  const { x, ele, annotate, bands, gradeKeys, climbs, theme } = args
  const n = x.length

  if (annotate === 'grade' && gradeKeys && bands.length > 0) {
    const sorted = [...bands].sort((a, b) => a.from - b.from)
    return keyedEntries(x, ele, gradeKeys, (k) => (k < 0 ? theme.accent : sorted[k].color))
  }

  if (annotate === 'climb' && climbs.length > 0) {
    const keys = new Int16Array(n)
    for (let ci = 0; ci < climbs.length; ci++) {
      const climb = climbs[ci]
      const from = Math.max(0, climb.startIdx)
      const to = Math.min(n - 1, climb.endIdx)
      for (let p = from; p <= to; p++) keys[p] = ci + 1
    }
    return keyedEntries(x, ele, keys, (k) =>
      k === 0 ? theme.accent : climbColor(climbs[k - 1].category),
    )
  }

  // off：整条一个颜色
  const data = new Array<[number, number]>(n)
  for (let i = 0; i < n; i++) data[i] = [x[i], ele[i]]
  return [{ color: theme.accent, data }]
}

/**
 * 连续同色段各自成段，非本色的位置填 null（connectNulls:false 会在 null 处断开）。
 * 段的取值为 [start-1, end+1]：左右各多写一个边界点，保证换色处不断线。
 */
function keyedEntries(
  x: Float64Array,
  ele: Float64Array,
  keys: Int16Array,
  colorOf: (key: number) => string,
): ColorEntry[] {
  const n = x.length
  const runs = new Map<number, Array<[number, number]>>()

  let i = 0
  while (i < n) {
    const k = keys[i]
    let j = i
    while (j + 1 < n && keys[j + 1] === k) j++
    const run: [number, number] = [Math.max(0, i - 1), Math.min(n - 1, j + 1)]
    const list = runs.get(k)
    if (list) list.push(run)
    else runs.set(k, [run])
    i = j + 1
  }

  const out: ColorEntry[] = []
  for (const k of [...runs.keys()].sort((a, b) => a - b)) {
    const data = new Array<[number, number] | null>(n).fill(null)
    for (const [a, b] of runs.get(k)!) {
      for (let p = a; p <= b; p++) data[p] = [x[p], ele[p]]
    }
    out.push({ color: colorOf(k), data })
  }
  return out
}

/* -------------------------------------------------------------- 系列 */

function fillSeries(entry: ColorEntry, index: number, theme: ChartTheme): Series {
  return {
    name: `fill-${index}`,
    type: 'line',
    data: entry.data,
    dimensions: ['x', 'ele'],
    // symbol:'none' 而不是只靠 showSymbol:false —— tooltip 走 axis 触发时会强制把
    // 吸附点的符号显示出来，而系列没显式给 itemStyle.color，符号就会回落到
    // ECharts 默认调色板（绿色 #91CC75），在一整套蓝橙配色里格外扎眼。
    symbol: 'none',
    showSymbol: false,
    connectNulls: false,
    animation: false,
    silent: true,
    z: 1,
    lineStyle: { opacity: 0, width: 0 },
    areaStyle: { color: areaGradient(entry.color, theme) },
    emphasis: { disabled: true },
    tooltip: { show: false },
  }
}

function lineSeries(entry: ColorEntry, index: number, theme: ChartTheme): Series {
  return {
    name: `line-${index}`,
    type: 'line',
    data: entry.data,
    dimensions: ['x', 'ele'],
    symbol: 'none',
    showSymbol: false,
    connectNulls: false,
    animation: false,
    z: 3,
    lineStyle: lineStyleFor(entry.color, theme),
    emphasis: { disabled: true },
  }
}

function lineStyleFor(color: string, theme: ChartTheme): Record<string, unknown> {
  // 明亮模式下折线是深色细线，没有背景发光衬托，所以线更粗、投影更实，
  // 否则和白底一对比就显得「飘」；暗色模式反过来，靠发光就够了。
  return {
    width: theme.isDark ? 2.1 : 2.4,
    color,
    cap: 'round',
    join: 'round',
    shadowBlur: theme.isDark ? 11 : 9,
    shadowColor: rgba(hexToRgbString(color), theme.isDark ? 0.34 : 0.24),
    shadowOffsetY: 1,
  }
}

/** 填充用「同色 + 自上而下衰减到透明」，让每个色段都有体积感 */
function areaGradient(color: string, theme: ChartTheme): Record<string, unknown> {
  const rgb = hexToRgbString(color)
  // 去饱和色（如未分级的灰蓝）需要更高透明度，才能和亮色填充有同样的视觉重量
  const boost = saturationBoost(color)
  const top = (theme.isDark ? 0.44 : 0.38) * boost
  const mid = (theme.isDark ? 0.23 : 0.19) * boost
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: `rgba(${rgb}, ${top.toFixed(3)})` },
      { offset: 0.5, color: `rgba(${rgb}, ${mid.toFixed(3)})` },
      { offset: 1, color: `rgba(${rgb}, 0.01)` },
    ],
  }
}

function saturationBoost(hex: string): number {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return 1
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16))
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const sat = max === 0 ? 0 : (max - min) / max
  return Math.min(1.75, Math.max(1, 0.6 / Math.max(sat, 0.2)))
}
