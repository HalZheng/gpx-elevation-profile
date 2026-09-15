export type SmoothMethod = 'none' | 'ma' | 'median' | 'median-ma'

/**
 * 坡度限幅（1-Lipschitz 双向滤波）。
 *
 * 气压高度计/GPS 高程常出现「阶跃」型异常：几秒内凭空上升或下降十几米，
 * 换算成坡度远超任何真实道路。直接平滑去不掉这种阶跃（它比中值窗口还宽），
 * 而双向限幅会把阶跃「摊开」成一条坡度不超过 maxGradePct 的坡道：
 *   - 保留总爬升量（只是把升降重新分配到了更长的距离上）
 *   - 消除物理上不可能出现的坡度尖峰
 */
export function limitSlope(
  src: Float64Array,
  dist: Float64Array,
  maxGradePct: number,
): Float64Array {
  const n = src.length
  const out = Float64Array.from(src)
  if (n < 2 || maxGradePct <= 0) return out
  const slope = maxGradePct / 100

  for (let i = 1; i < n; i++) {
    const cap = slope * Math.max(dist[i] - dist[i - 1], 0)
    if (out[i] - out[i - 1] > cap) out[i] = out[i - 1] + cap
    else if (out[i - 1] - out[i] > cap) out[i] = out[i - 1] - cap
  }
  for (let i = n - 2; i >= 0; i--) {
    const cap = slope * Math.max(dist[i + 1] - dist[i], 0)
    if (out[i] - out[i + 1] > cap) out[i] = out[i + 1] + cap
    else if (out[i + 1] - out[i] > cap) out[i] = out[i + 1] - cap
  }

  return out
}

/** 中值滤波，radius 以「点」为单位 */
function medianFilter(src: Float64Array, radius: number): Float64Array {
  const n = src.length
  if (radius < 1) return src.slice()
  const out = new Float64Array(n)
  const size = radius * 2 + 1
  let buf = new Float64Array(size)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radius)
    const b = Math.min(n - 1, i + radius)
    const len = b - a + 1
    if (len > buf.length) buf = new Float64Array(len)
    for (let j = 0; j < len; j++) buf[j] = src[a + j]
    const view = buf.subarray(0, len)
    view.sort()
    out[i] = view[len >> 1]
  }
  return out
}

/** 滑动平均（前缀和实现），radius 以「点」为单位 */
function movingAverage(src: Float64Array, radius: number): Float64Array {
  const n = src.length
  if (radius < 1) return src.slice()
  const out = new Float64Array(n)
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + src[i]
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radius)
    const b = Math.min(n - 1, i + radius)
    out[i] = (prefix[b + 1] - prefix[a]) / (b - a + 1)
  }
  return out
}

/**
 * 海拔平滑。窗口以「米」给出，内部按平均点距换算为点数半径，
 * 因此不同采样密度的 GPX（每 1 秒 1 点 vs 每 5 秒 1 点）表现一致。
 */
export function smoothElevation(
  src: Float64Array,
  method: SmoothMethod,
  windowMeters: number,
  totalDistance: number,
): Float64Array {
  if (method === 'none' || windowMeters <= 0) return src.slice()
  const n = src.length
  if (n < 3) return src.slice()

  const spacing = n > 1 ? Math.max(totalDistance / (n - 1), 0.5) : 5
  const radius = Math.max(1, Math.round(windowMeters / 2 / spacing))

  switch (method) {
    case 'ma':
      return movingAverage(src, radius)
    case 'median':
      return medianFilter(src, radius)
    case 'median-ma':
      // 先用中值剔除脉冲噪声（隧道、桥下、DEM 台阶），再轻微平滑
      return movingAverage(medianFilter(src, radius), Math.max(1, Math.round(radius / 2)))
    default:
      return src.slice()
  }
}
