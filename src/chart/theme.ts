export interface ChartTheme {
  text: string
  muted: string
  dim: string
  /** 图表内文字（刻度数字、轴名）专用色，明暗两套下都保证足够对比度 */
  chartText: string
  grid: string
  axis: string
  accent: string
  accentRgb: string
  raw: string
  surface: string
  tooltipBg: string
  tooltipBorder: string
  isDark: boolean
}

/** 从 CSS 变量读取当前主题色，保证图表与界面同源 */
export function readChartTheme(): ChartTheme {
  const cs = getComputedStyle(document.documentElement)
  const get = (name: string): string => cs.getPropertyValue(name).trim()
  const bg = get('--bg')

  return {
    text: get('--text'),
    muted: get('--text-muted'),
    dim: get('--text-dim'),
    chartText: get('--chart-text') || get('--text-dim'),
    grid: get('--grid-line'),
    axis: get('--axis-line'),
    accent: get('--accent'),
    accentRgb: get('--accent-rgb'),
    raw: get('--raw-line'),
    surface: get('--surface'),
    tooltipBg: get('--tooltip-bg'),
    tooltipBorder: get('--tooltip-border'),
    isDark: luminance(bg) < 0.5,
  }
}

export function rgba(rgb: string, alpha: number): string {
  return `rgba(${rgb}, ${alpha})`
}

/** '#RRGGBB' → 'r, g, b'，便于拼 rgba() */
export function hexToRgbString(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return '128, 128, 128'
  return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`
}

/** 调暗/调亮一个十六进制色，factor < 0 变暗、> 0 变亮 */
export function shadeHex(hex: string, factor: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return hex
  const adjust = (v: number): number => {
    const next = factor < 0 ? v * (1 + factor) : v + (255 - v) * factor
    return Math.max(0, Math.min(255, Math.round(next)))
  }
  const parts = [m[1], m[2], m[3]].map((h) => adjust(parseInt(h, 16)))
  return `#${parts.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** 在给定底色上挑一个可读的文字色（浅底用深字，深底用白字） */
export function readableInk(hex: string): string {
  return luminance(hex) > 0.58 ? '#0b0f14' : '#ffffff'
}

function luminance(hex: string): number {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return 0
  const r = parseInt(m[1], 16) / 255
  const g = parseInt(m[2], 16) / 255
  const b = parseInt(m[3], 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
