import './styles.css'

import echarts, { type EChartsInstance } from './chart/echarts'
import { buildChartOption } from './chart/options'
import { visibleYDomain, type YDomain } from './chart/scale'
import { readChartTheme, readableInk, rgba, shadeHex, type ChartTheme } from './chart/theme'
import { computeDistance, computeElapsed, rollingGrade, rollingSpeed } from './gpx/geo'
import { parseGpx } from './gpx/parse'
import { limitSlope, smoothElevation, type SmoothMethod } from './gpx/smooth'
import {
  calibrateElevation,
  estimateCalibration,
  resolveCalInterval,
  type CalIntervalChoice,
  type CalibrationResult,
} from './calibration/openmeteo'
import { computeSummary } from './analysis/stats'
import { DEFAULT_CLIMB_PARAMS, categoryLabel, climbColor, detectClimbs } from './analysis/climbs'
import { DEFAULT_BAND_PRESET, bandColorFor, normalizeBands, presetBands } from './analysis/bands'
import { classifyByGrade, countSegments } from './analysis/segments'
import * as fmt from './format'
import type {
  AnnotateMode,
  Climb,
  ClimbParams,
  GradeBand,
  Summary,
  Track,
  TrackSeries,
} from './types'

/* ------------------------------------------------------------------ DOM */
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`缺少 DOM 元素 #${id}`)
  return el as T
}

const el = {
  html: document.documentElement,
  emptyState: $('empty-state'),
  workspace: $('workspace'),
  dropzone: $('dropzone'),
  fileInput: $<HTMLInputElement>('file-input'),
  samples: $('samples'),
  metrics: $('metrics'),
  chart: $('chart'),
  chartSub: $('chart-sub'),
  climbs: $('climbs'),
  climbsSub: $('climbs-sub'),
  xmodeToggle: $('xmode-toggle'),
  themeToggle: $('theme-toggle'),
  toast: $('toast'),
  // panel
  smoothMethod: $<HTMLSelectElement>('smooth-method'),
  anomalyToggle: $<HTMLInputElement>('anomaly-toggle'),
  anomalyField: $('anomaly-field'),
  anomalyGrade: $<HTMLInputElement>('anomaly-grade'),
  anomalyGradeVal: $('anomaly-grade-val'),
  smoothWindow: $<HTMLInputElement>('smooth-window'),
  smoothWindowVal: $('smooth-window-val'),
  gradeWindow: $<HTMLInputElement>('grade-window'),
  gradeWindowVal: $('grade-window-val'),
  calInterval: $<HTMLSelectElement>('cal-interval'),
  btnCalibrate: $<HTMLButtonElement>('btn-calibrate'),
  calProgress: $('cal-progress'),
  calProgressBar: $('cal-progress-bar'),
  calMeta: $('cal-meta'),
  calEstimate: $('cal-estimate'),
  calDisplayField: $('cal-display-field'),
  calDisplayToggle: $('cal-display-toggle'),
  annotateToggle: $('annotate-toggle'),
  annotateHint: $('annotate-hint'),
  gradeBlock: $('grade-block'),
  bandPreset: $<HTMLSelectElement>('band-preset'),
  segMinlen: $<HTMLInputElement>('seg-minlen'),
  segMinlenVal: $('seg-minlen-val'),
  bands: $('bands'),
  btnBandAdd: $<HTMLButtonElement>('btn-band-add'),
  btnBandReset: $<HTMLButtonElement>('btn-band-reset'),
  pMinlen: $<HTMLInputElement>('p-minlen'),
  pMinlenVal: $('p-minlen-val'),
  pMingain: $<HTMLInputElement>('p-mingain'),
  pMingainVal: $('p-mingain-val'),
  pMingrade: $<HTMLInputElement>('p-mingrade'),
  pMingradeVal: $('p-mingrade-val'),
  fGrade: $<HTMLInputElement>('f-grade'),
  fSpeed: $<HTMLInputElement>('f-speed'),
  fHr: $<HTMLInputElement>('f-hr'),
  fCad: $<HTMLInputElement>('f-cad'),
  lockSpeed: $('lock-speed'),
  lockHr: $('lock-hr'),
  lockCad: $('lock-cad'),
  btnResetZoom: $<HTMLButtonElement>('btn-reset-zoom'),
  btnPanelReset: $<HTMLButtonElement>('btn-panel-reset'),
  btnOpen: $<HTMLButtonElement>('btn-open'),
  btnOpen2: $<HTMLButtonElement>('btn-open-2'),
}

/* ---------------------------------------------------------------- State */
type XMode = 'dist' | 'time'
type CalDisplay = 'raw' | 'cal' | 'both'

interface TooltipFields {
  grade: boolean
  speed: boolean
  hr: boolean
  cad: boolean
}

interface State {
  track: Track | null
  series: TrackSeries | null
  xDist: Float64Array | null
  xTime: Float64Array | null
  xMode: XMode

  smoothMethod: SmoothMethod
  smoothWindow: number
  gradeWindow: number
  /** 异常海拔修正（坡度限幅） */
  anomalyFix: boolean
  anomalyMaxGrade: number

  calib: CalibrationResult | null
  calDisplay: CalDisplay
  calibrating: boolean

  /** 折线标注方式：三种互斥，不共存 */
  annotate: AnnotateMode
  bandPreset: string
  bands: GradeBand[]
  /** 「按坡度」着色时允许的最短段长（米），过短的段会被并入邻居 */
  minSegLength: number

  climbParams: ClimbParams

  fields: TooltipFields
  zoom: { start: number; end: number }

  // derived
  eleRawSmooth: Float64Array | null
  activeEle: Float64Array | null
  grade: Float64Array | null
  /** 「按坡度」模式下逐点区间索引 */
  gradeKeys: Int16Array | null
  /** 当前着色段数，用于面板提示 */
  gradeSegmentCount: number
  climbs: Climb[]
  summary: Summary | null
  y: YDomain
}

const state: State = {
  track: null,
  series: null,
  xDist: null,
  xTime: null,
  xMode: 'dist',

  smoothMethod: 'median-ma',
  smoothWindow: 50,
  gradeWindow: 50,
  anomalyFix: true,
  anomalyMaxGrade: 20,

  calib: null,
  calDisplay: 'raw',
  calibrating: false,

  annotate: 'off',
  bandPreset: DEFAULT_BAND_PRESET,
  bands: presetBands(DEFAULT_BAND_PRESET),
  minSegLength: 200,

  climbParams: { ...DEFAULT_CLIMB_PARAMS },

  fields: { grade: true, speed: false, hr: false, cad: false },
  zoom: { start: 0, end: 100 },

  eleRawSmooth: null,
  activeEle: null,
  grade: null,
  gradeKeys: null,
  gradeSegmentCount: 0,
  climbs: [],
  summary: null,
  y: { min: 0, max: 100, interval: 20 },
}

let chart: EChartsInstance | null = null
let theme: ChartTheme = readChartTheme()
let resizeObserver: ResizeObserver | null = null
let smoothRaf = 0

/* ------------------------------------------------------------- Samples */
const SAMPLES = [
  {
    file: 'samples/ride-7km.gpx',
    name: '滨海短途',
    meta: '7.15 km · 21 分钟 · 含心率 / 踏频',
  },
  {
    file: 'samples/ride-83km.gpx',
    name: '长距离骑行',
    meta: '82.55 km · 4 小时 26 分 · 含踏频',
  },
]

/* ------------------------------------------------------------- Loading */
async function loadSample(sample: (typeof SAMPLES)[number]): Promise<void> {
  try {
    const url = `${import.meta.env.BASE_URL}${sample.file}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    loadTrack(parseGpx(text, sample.name, new Blob([text]).size))
  } catch (err) {
    toast(`示例加载失败：${errText(err)}`, true)
  }
}

function loadFile(file: File): void {
  if (file.size > 60 * 1024 * 1024) {
    toast('文件过大（超过 60 MB），请换一个 GPX 文件', true)
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    try {
      loadTrack(parseGpx(String(reader.result), file.name.replace(/\.gpx$/i, ''), file.size))
    } catch (err) {
      toast(`解析失败：${errText(err)}`, true)
    }
  }
  reader.onerror = () => toast('读取文件失败', true)
  reader.readAsText(file)
}

function loadTrack(track: Track): void {
  const n = track.points.length
  const dist = computeDistance(track.points, track.segStarts)
  const time = computeElapsed(track.points)
  const eleRaw = new Float64Array(n)
  const hr = new Float64Array(n)
  const cad = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = track.points[i]
    eleRaw[i] = isFinite(p.ele) ? p.ele : NaN
    hr[i] = isFinite(p.hr) ? p.hr : NaN
    cad[i] = isFinite(p.cad) ? p.cad : NaN
  }
  // 极少数缺失海拔：用前后有效值线性填补
  fillGaps(eleRaw)

  const speed = track.hasTime ? rollingSpeed(dist, time, 5) : new Float64Array(n).fill(NaN)

  state.track = track
  state.series = { dist, time, eleRaw, eleCal: null, speed, hr, cad }
  state.xDist = dist.map((v) => v / 1000)
  state.xTime = time.map((v) => v / 60)
  state.calib = null
  state.calDisplay = 'raw'
  state.zoom = { start: 0, end: 100 }
  state.minSegLength = defaultMinSegLength(dist[n - 1])

  // 换轨迹时同步复位校准面板与横轴尺度
  el.calMeta.textContent = ''
  el.calMeta.className = 'meta'
  el.calProgress.hidden = true
  el.calDisplayField.hidden = true
  syncCalDisplayButtons()
  renderCalEstimate()
  if (state.xMode === 'time' && !track.hasTime) state.xMode = 'dist'
  el.xmodeToggle.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.x === state.xMode))
  })

  el.emptyState.hidden = true
  el.workspace.hidden = false

  ensureChart()
  requestAnimationFrame(() => {
    chart?.resize()
    applyCapabilities()
    syncSegMinlenUI()
    rebuild()
  })
}

/** 用相邻有效值填平原数组中的 NaN */
function fillGaps(values: Float64Array): void {
  const n = values.length
  let firstValid = -1
  for (let i = 0; i < n; i++) {
    if (isFinite(values[i])) {
      firstValid = i
      break
    }
  }
  if (firstValid < 0) {
    values.fill(0)
    return
  }
  for (let i = 0; i < firstValid; i++) values[i] = values[firstValid]
  let last = firstValid
  for (let i = firstValid + 1; i < n; i++) {
    if (isFinite(values[i])) {
      if (i - last > 1) {
        const step = (values[i] - values[last]) / (i - last)
        for (let k = last + 1; k < i; k++) values[k] = values[last] + step * (k - last)
      }
      last = i
    }
  }
  for (let i = last + 1; i < n; i++) values[i] = values[last]
}

/* ------------------------------------------------------------ Pipeline */
function rebuild(): void {
  const track = state.track
  const series = state.series
  if (!track || !series) return

  const total = series.dist[series.dist.length - 1]
  // 先做异常修正（坡度限幅），再平滑 —— 顺序不能反：
  // 阶跃比中值窗口更宽，必须先摊开才能被后续平滑处理
  const prep = (src: Float64Array): Float64Array =>
    state.anomalyFix ? limitSlope(src, series.dist, state.anomalyMaxGrade) : src

  const rawSmooth = smoothElevation(
    prep(series.eleRaw),
    state.smoothMethod,
    state.smoothWindow,
    total,
  )
  const useCal = state.calib !== null && state.calDisplay !== 'raw'
  const activeEle = useCal
    ? smoothElevation(prep(state.calib!.ele), state.smoothMethod, state.smoothWindow, total)
    : rawSmooth

  const grade = rollingGrade(series.dist, activeEle, state.gradeWindow)
  const summary = computeSummary({
    dist: series.dist,
    time: series.time,
    ele: activeEle,
    grade,
    speed: series.speed,
    hr: series.hr,
    cad: series.cad,
  })
  const climbs = detectClimbs(series.dist, activeEle, grade, series.time, state.climbParams)

  state.eleRawSmooth = rawSmooth
  state.activeEle = activeEle
  state.grade = grade
  state.summary = summary
  state.climbs = climbs
  // 「按坡度」的逐点归类在这里算好：迟滞 + 过短段合并，避免图上出现几百个碎段
  state.gradeKeys =
    state.annotate === 'grade'
      ? classifyByGrade(grade, series.dist, state.bands, state.minSegLength)
      : null
  state.gradeSegmentCount = state.gradeKeys ? countSegments(state.gradeKeys) : 0

  renderMetrics()
  renderClimbs()
  syncAnnotateUI()
  renderChart(true)
}

function currentX(): Float64Array {
  return state.xMode === 'dist' ? state.xDist! : state.xTime!
}

function computeY(): YDomain {
  const x = currentX()
  const seriesArr: Float64Array[] = []
  if (state.activeEle) seriesArr.push(state.activeEle)
  if (state.calDisplay === 'both' && state.eleRawSmooth) seriesArr.push(state.eleRawSmooth)
  return visibleYDomain(x, seriesArr, state.zoom.start, state.zoom.end)
}

/* --------------------------------------------------------------- Chart */
function ensureChart(): EChartsInstance {
  if (chart) return chart
  chart = echarts.init(el.chart, undefined, { renderer: 'canvas' })
  chart.on('dataZoom', onDataZoom)
  chart.getZr().on('dblclick', () => resetZoom())
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(el.chart)
  }
  return chart
}

function renderChart(full: boolean): void {
  if (!state.track || !state.activeEle || !state.grade) return
  const instance = ensureChart()
  theme = readChartTheme()
  const x = currentX()
  const y = computeY()
  state.y = y

  const option = buildChartOption({
    theme,
    xMode: state.xMode,
    x,
    ele: state.activeEle,
    gradeKeys: state.gradeKeys,
    rawEle: state.calDisplay === 'both' ? state.eleRawSmooth : null,
    annotate: state.annotate,
    bands: state.bands,
    climbs: state.climbs,
    zoom: state.zoom,
    y,
    tooltipFormatter: tooltipHTML,
    tickFormatter: tickFormatter(),
  })

  instance.setOption(option as never, { notMerge: true })
}

function onDataZoom(): void {
  if (!chart || !state.track) return
  const option = chart.getOption() as { dataZoom?: Array<{ start?: number; end?: number }> }
  const dz = option.dataZoom?.[0]
  if (!dz || typeof dz.start !== 'number' || typeof dz.end !== 'number') return
  if (
    Math.abs(dz.start - state.zoom.start) < 0.002 &&
    Math.abs(dz.end - state.zoom.end) < 0.002
  ) {
    return
  }
  state.zoom = { start: dz.start, end: dz.end }
  const y = computeY()
  state.y = y
  chart.setOption({ yAxis: { min: y.min, max: y.max, interval: y.interval } } as never)
}

function resetZoom(): void {
  if (!chart || !state.track) return
  state.zoom = { start: 0, end: 100 }
  chart.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
  const y = computeY()
  state.y = y
  chart.setOption({ yAxis: { min: y.min, max: y.max, interval: y.interval } } as never)
}

function zoomToClimb(climb: Climb): void {
  if (!chart || !state.series) return
  const x = currentX()
  const min = x[0]
  const max = x[x.length - 1]
  const span = max - min || 1
  const a = state.xMode === 'dist' ? climb.startDist / 1000 : climb.startTime / 60
  const b =
    state.xMode === 'dist' ? climb.endDist / 1000 : (climb.startTime + climb.duration) / 60
  const padding = Math.max((b - a) * 0.18, span * 0.01)
  const start = Math.max(0, ((a - padding - min) / span) * 100)
  const end = Math.min(100, ((b + padding - min) / span) * 100)
  if (!isFinite(start) || !isFinite(end) || end <= start) return
  chart.dispatchAction({ type: 'dataZoom', start, end })
}

/* ------------------------------------------------------------ Tooltip */
function tickFormatter(): (v: number) => string {
  if (state.xMode === 'dist') {
    return (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1))
  }
  return (v: number) => {
    if (v <= 0.001) return '0'
    if (v < 60) return `${Math.round(v)}min`
    const h = Math.floor(v / 60)
    const m = Math.round(v % 60)
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
  }
}

/** 找到包含指定点的爬坡路段，用于悬浮气泡补充说明 */
function climbAt(idx: number): Climb | null {
  for (const climb of state.climbs) {
    if (idx >= climb.startIdx && idx <= climb.endIdx) return climb
  }
  return null
}

function tooltipHTML(idx: number): string {
  const series = state.series
  const track = state.track
  const ele = state.activeEle
  const grade = state.grade
  if (!series || !track || !ele || !grade) return ''

  const distM = series.dist[idx]
  const timeS = series.time[idx]
  const hasTime = track.hasTime && isFinite(timeS)
  const compare = state.calDisplay === 'both' && state.eleRawSmooth !== null

  const head =
    `<div class="ep-tip-head"><span>${fmt.fmtDistance(distM)} km</span>` +
    (hasTime ? `<em>${fmt.fmtClock(timeS)}</em>` : '') +
    `</div>`

  const rows: string[] = []
  const row = (dot: string, key: string, value: string): string =>
    `<div class="ep-row"><span class="k"><i class="ep-dot" style="background:${dot}"></i>${key}</span><span class="v">${value}</span></div>`

  if (compare) {
    rows.push(row(theme.raw, '原始海拔', `${Math.round(state.eleRawSmooth![idx])}<small>m</small>`))
    rows.push(row(theme.accent, '校准海拔', `${Math.round(ele[idx])}<small>m</small>`))
  } else {
    rows.push(row(theme.accent, '海拔', `${Math.round(ele[idx])}<small>m</small>`))
  }

  if (state.fields.grade) {
    const g = grade[idx]
    const bandDot = state.annotate === 'grade' ? bandColorFor(state.bands, g) : null
    rows.push(row(bandDot ?? theme.accent, '坡度', `${fmt.fmtSignedPct(g)}<small>%</small>`))
  }
  if (state.fields.speed && hasTime) {
    const v = series.speed[idx]
    rows.push(row(theme.muted, '速度', `${fmt.fmtSpeed(v)}<small>km/h</small>`))
  }
  if (state.fields.hr && track.hasHr) {
    const v = series.hr[idx]
    rows.push(row('#e5484d', '心率', isFinite(v) ? `${Math.round(v)}<small>bpm</small>` : '—'))
  }
  if (state.fields.cad && track.hasCad) {
    const v = series.cad[idx]
    rows.push(row('#7c8da6', '踏频', isFinite(v) ? `${Math.round(v)}<small>rpm</small>` : '—'))
  }

  const notes: string[] = []
  const climb = climbAt(idx)
  if (climb) {
    const level = climb.category ? categoryLabel(climb.category) : '未分级'
    notes.push(
      `<div class="ep-note">处于爬坡路段 · ${level} · 平均 ${climb.avgGrade.toFixed(1)}%</div>`,
    )
  }
  if (state.calib && state.calDisplay !== 'raw') {
    notes.push(`<div class="ep-note">海拔来源：Open-Meteo 地形校准</div>`)
  }

  return `<div class="ep-tip">${head}${rows.join('')}${notes.join('')}</div>`
}

/* ------------------------------------------------------------ Metrics */
function renderMetrics(): void {
  const summary = state.summary
  const track = state.track
  if (!summary || !track) {
    el.metrics.innerHTML = ''
    return
  }

  const cards: string[] = []
  const card = (label: string, value: string, accent = false): void => {
    cards.push(
      `<div class="metric${accent ? ' is-accent' : ''}"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`,
    )
  }

  card('距离', `${fmt.fmtDistance(summary.distance)}<small>km</small>`, true)
  card('累计爬升', `${fmt.fmtInt(summary.gain)}<small>m</small>`)
  card('平均坡度', `${fmt.fmtNum(summary.avgGrade, 1)}<small>%</small>`)
  card('最大坡度', `${fmt.fmtNum(summary.maxGrade, 1)}<small>%</small>`)
  card('最高海拔', `${fmt.fmtInt(summary.maxEle)}<small>m</small>`)
  if (track.hasTime) {
    card('骑行时长', fmt.fmtDuration(summary.duration))
    card('平均速度', `${fmt.fmtSpeed(summary.avgSpeed)}<small>km/h</small>`)
  }
  if (track.hasHr && summary.avgHr !== null) {
    card('平均心率', `${Math.round(summary.avgHr)}<small>bpm</small>`)
  }
  if (track.hasCad && summary.avgCad !== null) {
    card('平均踏频', `${Math.round(summary.avgCad)}<small>rpm</small>`)
  }

  el.metrics.innerHTML = cards.join('')

  const bits = [`${track.points.length.toLocaleString('zh-CN')} 个轨迹点`]
  if (state.calib && state.calDisplay !== 'raw') bits.push('已校准海拔')
  if (state.annotate === 'grade') bits.push('按坡度着色')
  else if (state.annotate === 'climb') bits.push('按爬坡等级着色')
  el.chartSub.textContent = bits.join(' · ')
}

/* ------------------------------------------------------------- Climbs */
function renderClimbs(): void {
  const climbs = state.climbs
  el.climbsSub.textContent =
    climbs.length > 0 ? `识别到 ${climbs.length} 段 · 点击可放大到该路段` : ''

  if (climbs.length === 0) {
    el.climbs.innerHTML = `<div class="empty-note">当前阈值下没有识别到爬坡路段，可在右侧「识别参数」中放宽条件。</div>`
    return
  }

  el.climbs.innerHTML = climbs
    .map((climb, i) => {
      const color = climbColor(climb.category)
      const badgeText = climb.category ? categoryLabel(climb.category).replace('Cat ', '') : '—'
      const stats: string[] = [
        `长度 <b>${(climb.length / 1000).toFixed(2)}</b> km`,
        `平均坡度 <b>${climb.avgGrade.toFixed(1)}</b> %`,
        `爬升 <b>${Math.round(climb.gain)}</b> m`,
        `最陡 <b>${climb.maxGrade.toFixed(1)}</b> %`,
      ]
      if (isFinite(climb.duration) && climb.duration > 0) {
        stats.push(`用时 <b>${fmt.fmtDuration(climb.duration)}</b>`)
      }
      const scoreText = climb.category
        ? `Strava 评分 <b>${fmt.fmtInt(climb.score)}</b>`
        : `评分 <b>${fmt.fmtInt(climb.score)}</b>（未达分级）`

      return (
        `<button type="button" class="climb" data-climb="${i}">` +
        `<span class="climb-badge" style="background:linear-gradient(160deg, ${color}, ${shadeHex(color, -0.3)});color:${readableInk(color)}">${badgeText}</span>` +
        `<span class="climb-main">` +
        `<span class="climb-title">爬坡 ${i + 1} · ${fmt.fmtDistance(climb.startDist)} km 处` +
        `<span>${climb.category ? categoryLabel(climb.category) : '未分级'}</span></span>` +
        `<span class="climb-stats">${stats.join('')}</span>` +
        `</span>` +
        `<span class="climb-score">${scoreText}</span>` +
        `</button>`
      )
    })
    .join('')

  el.climbs.querySelectorAll<HTMLButtonElement>('[data-climb]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.climb)
      const climb = state.climbs[idx]
      if (climb) zoomToClimb(climb)
    })
  })
}

/* -------------------------------------------------------------- Bands */
function renderBands(): void {
  const bands = state.bands
  el.bands.innerHTML = bands
    .map((band, i) => {
      const isLast = i === bands.length - 1
      const toCell = isLast
        ? `<input type="text" value="∞" disabled />`
        : `<input type="number" value="${band.to}" step="0.5" min="0" data-band-to="${i}" />`
      return (
        `<div class="band">` +
        `<input type="color" value="${band.color}" data-band-color="${i}" aria-label="区间颜色" />` +
        `<input type="number" value="${band.from}" step="0.5" min="-20" data-band-from="${i}" />` +
        `<span class="dash">–</span>` +
        toCell +
        `<button type="button" class="band-del" data-band-del="${i}" aria-label="删除区间">×</button>` +
        `</div>`
      )
    })
    .join('')

  el.bands.querySelectorAll<HTMLInputElement>('[data-band-color]').forEach((input) => {
    input.addEventListener('input', () => {
      const i = Number(input.dataset.bandColor)
      state.bands[i].color = input.value
      renderChart(true)
    })
  })

  el.bands.querySelectorAll<HTMLInputElement>('[data-band-from]').forEach((input) => {
    input.addEventListener('change', () => {
      const i = Number(input.dataset.bandFrom)
      const v = Number(input.value)
      if (!isFinite(v)) return
      state.bands[i].from = v
      state.bands = normalizeBands(state.bands)
      state.bandPreset = ''
      renderBands()
      if (state.track) rebuild()
    })
  })

  el.bands.querySelectorAll<HTMLInputElement>('[data-band-to]').forEach((input) => {
    input.addEventListener('change', () => {
      const i = Number(input.dataset.bandTo)
      const v = Number(input.value)
      if (!isFinite(v) || v <= state.bands[i].from) {
        input.value = String(state.bands[i].to)
        return
      }
      state.bands[i].to = v
      state.bandPreset = ''
      if (state.track) rebuild()
    })
  })

  el.bands.querySelectorAll<HTMLButtonElement>('[data-band-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.bandDel)
      if (state.bands.length <= 1) {
        toast('至少保留一个区间', true)
        return
      }
      state.bands.splice(i, 1)
      state.bands = normalizeBands(state.bands)
      state.bandPreset = ''
      renderBands()
      if (state.track) rebuild()
    })
  })
}

/* -------------------------------------------------------------- 校准 */

function calIntervalChoice(): CalIntervalChoice {
  const raw = el.calInterval.value
  return raw === 'auto' ? 'auto' : Number(raw)
}

/**
 * 显示本次校准会发多少请求、是否需要等待。
 * Open-Meteo 免费额度按「坐标个数」计（600 次/分），长轨迹用细间隔必然触发限流，
 * 所以这里提前把代价摊开给用户看，而不是点下去才 429。
 */
function renderCalEstimate(): void {
  const series = state.series
  if (!series) {
    el.calEstimate.textContent = ''
    return
  }
  const total = series.dist[series.dist.length - 1]
  const interval = resolveCalInterval(calIntervalChoice(), total)
  const { points, requests, estimatedWaitMs } = estimateCalibration(total, interval)

  const bits = [`每 ${Math.round(interval)} m 采样 · ${points.toLocaleString('zh-CN')} 个点 · ${requests} 次请求`]
  if (estimatedWaitMs > 0) {
    const secs = Math.round(estimatedWaitMs / 1000)
    const label = secs >= 60 ? `约 ${Math.ceil(secs / 60)} 分钟` : `约 ${secs} 秒`
    bits.push(`受 600 次/分额度限制，需等待${label}`)
  }
  el.calEstimate.textContent = bits.join(' · ')

  // 已缓存相同间隔则无需再请求
  if (state.calib && state.calib.interval === interval) {
    el.calEstimate.textContent += ' · 已有缓存，点击将直接复用'
  }
}

async function runCalibration(): Promise<void> {
  const track = state.track
  const series = state.series
  if (!track || !series || state.calibrating) return

  state.calibrating = true
  el.btnCalibrate.classList.add('is-loading')
  el.btnCalibrate.textContent = '获取中…'
  el.calProgress.hidden = false
  el.calProgressBar.style.width = '0%'
  el.calMeta.className = 'meta'
  el.calMeta.textContent = '正在按经纬度请求地形海拔…'

  const choice = calIntervalChoice()
  const interval = resolveCalInterval(choice, series.dist[series.dist.length - 1])

  try {
    // 同参数直接复用，避免重复请求
    if (state.calib && state.calib.interval === interval) {
      el.calMeta.textContent = '已使用缓存结果（采样间隔未变）'
    } else {
      const result = await calibrateElevation(track.points, series.dist, {
        intervalMeters: interval,
        onProgress: ({ done, total, phase, waitMs }) => {
          el.calProgressBar.style.width = `${Math.round((done / total) * 100)}%`
          if (phase === 'wait') {
            el.calMeta.textContent = `已采样 ${done} / ${total} 个点 · 触发接口频率限制，等待 ${Math.ceil(waitMs / 1000)} s 后继续…`
          } else {
            el.calMeta.textContent = `已采样 ${done} / ${total} 个点…`
          }
        },
      })
      state.calib = result
      series.eleCal = result.ele
    }

    const result = state.calib!
    el.calMeta.className = 'meta is-ok'
    const waitNote =
      result.waitedMs > 1000 ? ` · 含限流等待 ${Math.round(result.waitedMs / 1000)} s` : ''
    el.calMeta.textContent = `完成 · ${result.sampleCount} 个采样点（每 ${Math.round(result.interval)} m） / ${result.requestCount} 次请求${waitNote} · ${result.source}`
    el.calDisplayField.hidden = false
    setCalDisplay(state.calDisplay === 'raw' ? 'cal' : state.calDisplay)
    renderCalEstimate()
  } catch (err) {
    el.calMeta.className = 'meta is-err'
    el.calMeta.textContent = errText(err)
    renderCalEstimate()
  } finally {
    state.calibrating = false
    el.btnCalibrate.classList.remove('is-loading')
    el.btnCalibrate.textContent = '获取校准海拔'
    el.calProgress.hidden = true
  }
}

function syncCalDisplayButtons(): void {
  el.calDisplayToggle.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.cal === state.calDisplay))
  })
}

function setCalDisplay(mode: CalDisplay): void {
  state.calDisplay = mode
  syncCalDisplayButtons()
  if (state.track) rebuild()
}

/**
 * 着色最短段长的默认值：按总距离比例给，并夹在给定范围内。
 * 下限 150 m 是「骑行体感」——再短的坡段人还来不及感觉就已经过去了；
 * 上限 500 m 是防止把一条起伏路整段合并成单一颜色。
 */
function defaultMinSegLength(totalMeters: number): number {
  const raw = Math.min(500, Math.max(150, totalMeters * 0.005))
  return Math.round(raw / 50) * 50
}

function syncSegMinlenUI(): void {
  el.segMinlen.value = String(state.minSegLength)
  el.segMinlenVal.textContent = state.minSegLength === 0 ? '不合并' : `${state.minSegLength} m`
}

const ANNOTATE_HINTS: Record<AnnotateMode, string> = {
  off: '只画一条高亮折线与同色渐变填充，不做任何分段着色。',
  grade: '按坡度区间着色，填充同色。已做迟滞与过短段合并，呈现的是持续一段的坡度，不是逐点跳变。',
  climb: '非爬坡段用高亮主色；识别出的爬坡段按 Strava 等级着色，未分级为灰蓝。',
}

function syncAnnotateUI(): void {
  el.annotateToggle.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.annotate === state.annotate))
  })
  el.gradeBlock.hidden = state.annotate !== 'grade'
  const segments =
    state.annotate === 'grade' && state.track ? `（当前 ${state.gradeSegmentCount} 段）` : ''
  el.annotateHint.textContent = ANNOTATE_HINTS[state.annotate] + segments
}

function setAnnotate(mode: AnnotateMode): void {
  state.annotate = mode
  // 切到「按坡度」需要重做区间归类，因此走完整重建
  if (state.track) rebuild()
  else syncAnnotateUI()
}

/* ---------------------------------------------------------- Capability */
function applyCapabilities(): void {
  const track = state.track
  if (!track) return

  const setLock = (
    input: HTMLInputElement,
    lock: HTMLElement,
    available: boolean,
    label: string,
  ): void => {
    input.disabled = !available
    lock.hidden = available
    if (!available) {
      input.checked = false
      state.fields[label as keyof TooltipFields] = false
    }
  }

  setLock(el.fSpeed, el.lockSpeed, track.hasTime, 'speed')
  setLock(el.fHr, el.lockHr, track.hasHr, 'hr')
  setLock(el.fCad, el.lockCad, track.hasCad, 'cad')
}

/* --------------------------------------------------------------- Misc */
function errText(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return '已取消'
  return err instanceof Error ? err.message : String(err)
}

let toastTimer = 0
function toast(message: string, isError = false): void {
  el.toast.textContent = message
  el.toast.className = `toast is-show${isError ? ' is-err' : ''}`
  el.toast.hidden = false
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    el.toast.className = 'toast'
  }, 2600)
}

function debouncedRebuild(): void {
  window.cancelAnimationFrame(smoothRaf)
  smoothRaf = window.requestAnimationFrame(() => rebuild())
}

/* ----------------------------------------------------- Theme handling */
type ThemeMode = 'auto' | 'light' | 'dark'

function setThemeMode(mode: ThemeMode): void {
  el.html.dataset.theme = mode
  try {
    localStorage.setItem('ep-theme', mode)
  } catch {
    /* 忽略隐私模式下的存储异常 */
  }
  el.themeToggle.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.themeValue === mode))
  })
  theme = readChartTheme()
  if (state.track && chart) renderChart(true)
}

/* --------------------------------------------------------------- Init */
function init(): void {
  // 主题
  let saved: ThemeMode = 'auto'
  try {
    const v = localStorage.getItem('ep-theme')
    if (v === 'light' || v === 'dark' || v === 'auto') saved = v
  } catch {
    /* ignore */
  }
  setThemeMode(saved)

  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (el.html.dataset.theme === 'auto' && state.track && chart) {
        theme = readChartTheme()
        renderChart(true)
      }
    })

  el.themeToggle.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => setThemeMode(btn.dataset.themeValue as ThemeMode))
  })

  // 示例
  el.samples.innerHTML = SAMPLES.map(
    (s, i) =>
      `<button type="button" class="sample-btn" data-sample="${i}"><b>${s.name}</b><span>${s.meta}</span></button>`,
  ).join('')
  el.samples.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach((btn) => {
    btn.addEventListener('click', () => void loadSample(SAMPLES[Number(btn.dataset.sample)]))
  })

  // 文件
  el.btnOpen.addEventListener('click', () => el.fileInput.click())
  el.btnOpen2.addEventListener('click', () => el.fileInput.click())
  el.fileInput.addEventListener('change', () => {
    const file = el.fileInput.files?.[0]
    if (file) loadFile(file)
    el.fileInput.value = ''
  })

  el.dropzone.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target === el.dropzone || target.closest('.dropzone-art')) {
      el.fileInput.click()
    }
  })
  ;['dragenter', 'dragover'].forEach((type) => {
    window.addEventListener(type, (e) => {
      e.preventDefault()
      el.dropzone.classList.add('is-drag')
    })
  })
  ;['dragleave', 'drop'].forEach((type) => {
    window.addEventListener(type, (e) => {
      e.preventDefault()
      if (type === 'dragleave' && e.target !== el.dropzone) return
      el.dropzone.classList.remove('is-drag')
    })
  })
  window.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0]
    if (file) loadFile(file)
  })

  // 横轴尺度
  el.xmodeToggle.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state.track) return
      const mode = btn.dataset.x as XMode
      if (mode === 'time' && !state.track.hasTime) {
        toast('该轨迹没有时间数据，无法切换为时间尺度', true)
        return
      }
      state.xMode = mode
      el.xmodeToggle.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.x === mode))
      })
      renderChart(true)
    })
  })
  el.xmodeToggle.querySelector('button')?.setAttribute('aria-pressed', 'true')

  // 平滑
  el.smoothMethod.addEventListener('change', () => {
    state.smoothMethod = el.smoothMethod.value as SmoothMethod
    rebuild()
  })
  el.anomalyToggle.addEventListener('change', () => {
    state.anomalyFix = el.anomalyToggle.checked
    el.anomalyField.hidden = !state.anomalyFix
    rebuild()
  })
  el.anomalyGrade.addEventListener('input', () => {
    state.anomalyMaxGrade = Number(el.anomalyGrade.value)
    el.anomalyGradeVal.textContent = `${state.anomalyMaxGrade} %`
    debouncedRebuild()
  })
  el.smoothWindow.addEventListener('input', () => {
    state.smoothWindow = Number(el.smoothWindow.value)
    el.smoothWindowVal.textContent = `${state.smoothWindow} m`
    debouncedRebuild()
  })
  el.gradeWindow.addEventListener('input', () => {
    state.gradeWindow = Number(el.gradeWindow.value)
    el.gradeWindowVal.textContent = `${state.gradeWindow} m`
    debouncedRebuild()
  })

  // 校准
  el.btnCalibrate.addEventListener('click', () => void runCalibration())
  el.calInterval.addEventListener('change', () => renderCalEstimate())
  el.calDisplayToggle.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => setCalDisplay(btn.dataset.cal as CalDisplay))
  })

  // 标注方式（三选一，互斥）
  el.annotateToggle.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => setAnnotate(btn.dataset.annotate as AnnotateMode))
  })

  el.bandPreset.addEventListener('change', () => {
    state.bandPreset = el.bandPreset.value
    state.bands = presetBands(state.bandPreset)
    renderBands()
    if (state.track) rebuild()
  })
  el.btnBandAdd.addEventListener('click', () => {
    const last = state.bands[state.bands.length - 1]
    const from = isFinite(last.to) ? last.to : last.from + 5
    state.bands = normalizeBands([...state.bands, { from, to: from + 3, color: '#4C93E8' }])
    state.bandPreset = ''
    renderBands()
    if (state.track) rebuild()
  })
  el.btnBandReset.addEventListener('click', () => {
    state.bandPreset = DEFAULT_BAND_PRESET
    el.bandPreset.value = DEFAULT_BAND_PRESET
    state.bands = presetBands(DEFAULT_BAND_PRESET)
    renderBands()
    if (state.track) rebuild()
  })
  el.segMinlen.addEventListener('input', () => {
    state.minSegLength = Number(el.segMinlen.value)
    syncSegMinlenUI()
    debouncedRebuild()
  })

  const bindRange = (
    input: HTMLInputElement,
    output: HTMLElement,
    apply: (v: number) => void,
    format: (v: number) => string,
  ): void => {
    input.addEventListener('input', () => {
      const v = Number(input.value)
      output.textContent = format(v)
      apply(v)
      debouncedRebuild()
    })
  }
  bindRange(
    el.pMinlen,
    el.pMinlenVal,
    (v) => (state.climbParams.minLength = v),
    (v) => `${v} m`,
  )
  bindRange(
    el.pMingain,
    el.pMingainVal,
    (v) => (state.climbParams.minGain = v),
    (v) => `${v} m`,
  )
  bindRange(
    el.pMingrade,
    el.pMingradeVal,
    (v) => (state.climbParams.minGrade = v),
    (v) => `${v.toFixed(1)} %`,
  )

  // 悬浮字段
  el.fGrade.addEventListener('change', () => (state.fields.grade = el.fGrade.checked))
  el.fSpeed.addEventListener('change', () => (state.fields.speed = el.fSpeed.checked))
  el.fHr.addEventListener('change', () => (state.fields.hr = el.fHr.checked))
  el.fCad.addEventListener('change', () => (state.fields.cad = el.fCad.checked))

  // 缩放
  el.btnResetZoom.addEventListener('click', () => resetZoom())
  el.btnPanelReset.addEventListener('click', () => resetSettings())

  renderBands()
  syncAnnotateUI()
}

function resetSettings(): void {
  state.smoothMethod = 'median-ma'
  state.smoothWindow = 50
  state.gradeWindow = 50
  state.annotate = 'off'
  state.bandPreset = DEFAULT_BAND_PRESET
  state.bands = presetBands(DEFAULT_BAND_PRESET)
  state.minSegLength = state.series
    ? defaultMinSegLength(state.series.dist[state.series.dist.length - 1])
    : 200
  state.climbParams = { ...DEFAULT_CLIMB_PARAMS }
  state.fields = { grade: true, speed: false, hr: false, cad: false }
  state.calDisplay = state.calib ? 'cal' : 'raw'

  el.smoothMethod.value = state.smoothMethod
  el.anomalyToggle.checked = state.anomalyFix
  el.anomalyField.hidden = !state.anomalyFix
  el.anomalyGrade.value = String(state.anomalyMaxGrade)
  el.anomalyGradeVal.textContent = `${state.anomalyMaxGrade} %`
  el.smoothWindow.value = String(state.smoothWindow)
  el.smoothWindowVal.textContent = `${state.smoothWindow} m`
  el.gradeWindow.value = String(state.gradeWindow)
  el.gradeWindowVal.textContent = `${state.gradeWindow} m`
  el.bandPreset.value = DEFAULT_BAND_PRESET
  syncSegMinlenUI()
  syncAnnotateUI()
  el.pMinlen.value = String(DEFAULT_CLIMB_PARAMS.minLength)
  el.pMinlenVal.textContent = `${DEFAULT_CLIMB_PARAMS.minLength} m`
  el.pMingain.value = String(DEFAULT_CLIMB_PARAMS.minGain)
  el.pMingainVal.textContent = `${DEFAULT_CLIMB_PARAMS.minGain} m`
  el.pMingrade.value = String(DEFAULT_CLIMB_PARAMS.minGrade)
  el.pMingradeVal.textContent = `${DEFAULT_CLIMB_PARAMS.minGrade.toFixed(1)} %`
  el.fGrade.checked = true
  if (!el.fSpeed.disabled) el.fSpeed.checked = false
  if (!el.fHr.disabled) el.fHr.checked = false
  if (!el.fCad.disabled) el.fCad.checked = false

  renderBands()
  if (state.track) {
    applyCapabilities()
    el.calDisplayToggle.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.cal === state.calDisplay))
    })
    rebuild()
  }
  toast('已恢复默认设置')
}

init()

/* 供调试与自动化测试使用 */
;(window as unknown as Record<string, unknown>).__ep = {
  state,
  rgba,
  echarts,
  getChart: () => chart,
  resetZoom,
  rebuild,
}
