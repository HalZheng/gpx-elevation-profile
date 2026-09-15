import type { GradeBand } from '../types'

export interface BandPreset {
  id: string
  label: string
  bands: GradeBand[]
}

const INF = Number.POSITIVE_INFINITY

export const BAND_PRESETS: BandPreset[] = [
  {
    id: 'default',
    label: '默认 · 陡坡高亮',
    // 最低区间刻意用主色系的蓝：平路/缓坡保持基础观感，
    // 只有真正变陡的路段才跳成青 → 琥珀 → 橙 → 红，颜色即"注意这里"
    bands: [
      { from: 0, to: 2, color: '#4C93E8' },
      { from: 2, to: 4, color: '#35C29A' },
      { from: 4, to: 6, color: '#E8C44A' },
      { from: 6, to: 8, color: '#F0871F' },
      { from: 8, to: 10, color: '#E5484D' },
      { from: 10, to: INF, color: '#9E1B34' },
    ],
  },
  {
    id: 'soft',
    label: '柔和',
    bands: [
      { from: 0, to: 2, color: '#93A3B8' },
      { from: 2, to: 4, color: '#5FB3D9' },
      { from: 4, to: 6, color: '#6BC7A8' },
      { from: 6, to: 8, color: '#E8C46A' },
      { from: 8, to: 10, color: '#E0917A' },
      { from: 10, to: INF, color: '#C96A87' },
    ],
  },
  {
    id: 'mono',
    label: '单色渐进',
    bands: [
      { from: 0, to: 2, color: '#2E5A8A' },
      { from: 2, to: 4, color: '#3576AD' },
      { from: 4, to: 6, color: '#3E93CE' },
      { from: 6, to: 8, color: '#4AB0E6' },
      { from: 8, to: INF, color: '#62CDF7' },
    ],
  },
]

export const DEFAULT_BAND_PRESET = 'default'

export function presetBands(id: string): GradeBand[] {
  const preset = BAND_PRESETS.find((p) => p.id === id) ?? BAND_PRESETS[0]
  return preset.bands.map((b) => ({ ...b }))
}

/** 保证区间有序、起止合法 */
export function normalizeBands(bands: GradeBand[]): GradeBand[] {
  const sorted = [...bands].sort((a, b) => a.from - b.from)
  return sorted.map((b) => ({ ...b, to: b.to < b.from ? b.from : b.to }))
}

/** 找出某个坡度落在哪个区间，用于气泡配色 */
export function bandColorFor(bands: GradeBand[], grade: number): string | null {
  for (const b of bands) {
    if (grade >= b.from && grade < b.to) return b.color
  }
  return null
}
