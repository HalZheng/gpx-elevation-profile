import type { RawPoint, Track } from '../types'

/**
 * 解析 GPX（单文件、纯浏览器端）。
 * 兼容 Garmin / Wahoo / Strava 导出的扩展写法：心率与踏频按 localName 匹配，
 * 因此 `gpxtpx:hr`、`ns3:hr`、`hr` 等任意前缀都能识别。
 */
export function parseGpx(text: string, fallbackName: string, bytes: number): Track {
  const doc = new DOMParser().parseFromString(text, 'application/xml')

  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('文件不是有效的 XML，无法解析为 GPX')
  }

  const trksegs = Array.from(doc.getElementsByTagName('trkseg'))
  const segStarts: number[] = []
  const points: RawPoint[] = []

  const pushSegment = (el: Element) => {
    segStarts.push(points.length)
    const trkpts = el.getElementsByTagName('trkpt')
    for (let i = 0; i < trkpts.length; i++) {
      const pt = readPoint(trkpts[i])
      if (pt) points.push(pt)
    }
  }

  if (trksegs.length > 0) {
    trksegs.forEach(pushSegment)
  } else {
    // 兜底：没有 trkseg 时（部分工具只写 rte）直接取全部 trkpt
    const all = doc.getElementsByTagName('trkpt')
    if (all.length === 0) throw new Error('文件中未找到任何轨迹点（trkpt）')
    segStarts.push(0)
    for (let i = 0; i < all.length; i++) {
      const pt = readPoint(all[i])
      if (pt) points.push(pt)
    }
  }

  if (points.length < 2) throw new Error('轨迹点太少，无法绘制海拔剖面')

  const withTime = points.reduce((n, p) => n + (isFinite(p.time) ? 1 : 0), 0)
  const timeSpan =
    withTime > 0
      ? lastFinite(points, (p) => p.time) - firstFinite(points, (p) => p.time)
      : 0
  const hasTime = withTime >= points.length * 0.8 && timeSpan > 0

  const hrCount = points.reduce((n, p) => n + (isFinite(p.hr) ? 1 : 0), 0)
  const cadCount = points.reduce((n, p) => n + (isFinite(p.cad) ? 1 : 0), 0)
  const hasHr = hrCount >= points.length * 0.5
  const hasCad = cadCount >= points.length * 0.5

  return {
    name: readTrackName(doc) || fallbackName,
    points,
    segStarts,
    hasTime,
    hasHr,
    hasCad,
    bytes,
  }
}

function readPoint(el: Element): RawPoint | null {
  const lat = Number.parseFloat(el.getAttribute('lat') ?? '')
  const lon = Number.parseFloat(el.getAttribute('lon') ?? '')
  if (!isFinite(lat) || !isFinite(lon)) return null

  let ele = NaN
  let time = NaN
  let hr = NaN
  let cad = NaN

  const kids = el.getElementsByTagName('*')
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i]
    const text = child.textContent ?? ''
    switch (child.localName) {
      case 'ele':
        if (!isFinite(ele)) ele = Number.parseFloat(text)
        break
      case 'time':
        if (!isFinite(time)) time = Date.parse(text)
        break
      case 'hr':
        if (!isFinite(hr)) hr = Number.parseFloat(text)
        break
      case 'cad':
        if (!isFinite(cad)) cad = Number.parseFloat(text)
        break
      default:
        break
    }
  }

  return { lat, lon, ele, time, hr, cad }
}

function readTrackName(doc: Document): string {
  const trkName = doc.getElementsByTagName('trk')[0]?.getElementsByTagName('name')[0]
  const text = trkName?.textContent?.trim()
  return text || ''
}

function firstFinite(points: RawPoint[], pick: (p: RawPoint) => number): number {
  for (const p of points) {
    const v = pick(p)
    if (isFinite(v)) return v
  }
  return 0
}

function lastFinite(points: RawPoint[], pick: (p: RawPoint) => number): number {
  for (let i = points.length - 1; i >= 0; i--) {
    const v = pick(points[i])
    if (isFinite(v)) return v
  }
  return 0
}
