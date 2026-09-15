/** 数值格式化工具 */

export function fmtDistance(meters: number, digits = 2): string {
  const km = meters / 1000
  return km.toFixed(digits)
}

/** 秒 → 1h23m / 21m08s */
export function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.round(sec % 60)
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  return `${m}m${String(s).padStart(2, '0')}s`
}

/** 秒 → h:mm:ss / m:ss */
export function fmtClock(sec: number): string {
  if (!isFinite(sec)) return '—'
  const sign = sec < 0 ? '-' : ''
  const t = Math.abs(Math.round(sec))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  if (h > 0) return `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${sign}${m}:${String(s).padStart(2, '0')}`
}

/** 坐标轴刻度用的短时长 */
export function fmtClockShort(sec: number): string {
  const t = Math.max(0, sec)
  const h = Math.floor(t / 3600)
  const m = Math.round((t % 3600) / 60)
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`
  return `${Math.round(t / 60)}m`
}

export function fmtSpeed(mps: number, digits = 1): string {
  if (!isFinite(mps)) return '—'
  return (mps * 3.6).toFixed(digits)
}

export function fmtNum(v: number, digits = 0): string {
  if (!isFinite(v)) return '—'
  return v.toFixed(digits)
}

export function fmtSignedPct(v: number, digits = 1): string {
  if (!isFinite(v)) return '—'
  const s = v.toFixed(digits)
  return v > 0 ? `+${s}` : s
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function fmtInt(n: number): string {
  if (!isFinite(n)) return '—'
  return Math.round(n).toLocaleString('zh-CN')
}
