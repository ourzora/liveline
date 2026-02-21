import type { ChartLayout, LivelinePalette } from '../types'
import { drawSpline } from '../math/spline'

export interface CandlePoint {
  time: number   // unix seconds — candle open time
  open: number
  high: number
  low: number
  close: number
}

const BULL = '#22c55e'
const BEAR = '#ef4444'

// Pre-parsed RGB for fast interpolation
const BULL_RGB = [34, 197, 94] as const
const BEAR_RGB = [239, 68, 68] as const

/** Blend bear→bull by t (0=bear, 1=bull). */
function blendColor(t: number): string {
  const r = Math.round(BEAR_RGB[0] + (BULL_RGB[0] - BEAR_RGB[0]) * t)
  const g = Math.round(BEAR_RGB[1] + (BULL_RGB[1] - BEAR_RGB[1]) * t)
  const b = Math.round(BEAR_RGB[2] + (BULL_RGB[2] - BEAR_RGB[2]) * t)
  return `rgb(${r},${g},${b})`
}

/** Parse "#rrggbb" or "rgb(r,g,b)" to [r,g,b]. */
function parseRgb(color: string): [number, number, number] {
  const hex = color.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const h = hex[1]
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const rgb = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]]
  return [128, 128, 128]
}

/** Blend a candle color toward an accent color by t. */
function blendToAccent(candleColor: string, accentColor: string, t: number): string {
  if (t <= 0) return candleColor
  if (t >= 1) return accentColor
  const [r1, g1, b1] = parseRgb(candleColor)
  const [r2, g2, b2] = parseRgb(accentColor)
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  return `rgb(${r},${g},${b})`
}

/**
 * Compute pixel dimensions for candle rendering.
 */
function candleDims(layout: ChartLayout, candleWidthSecs: number) {
  const pxPerSec = layout.chartW / (layout.rightEdge - layout.leftEdge)
  const candlePxW = candleWidthSecs * pxPerSec
  const bodyW = Math.max(1, candlePxW * 0.7)
  const wickW = Math.max(0.8, Math.min(2, bodyW * 0.15))
  const radius = bodyW > 6 ? 1.5 : 0
  return { bodyW, wickW, radius }
}

/**
 * Rounded rect helper — draws path only (caller fills/strokes).
 */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  if (r <= 0 || h < r * 2) {
    ctx.rect(x, y, w, h)
    return
  }
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/**
 * Draw OHLC candlesticks with live candle glow + scrub dimming.
 * Respects incoming ctx.globalAlpha for cross-fade/reveal support.
 */
export function drawCandlesticks(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  candles: CandlePoint[],
  candleWidthSecs: number,
  liveTime: number,
  now_ms: number,
  scrubX: number,
  scrubDim: number,
  liveAlpha = 1,
  liveBullBlend = -1,
  accentColor?: string,
  accentBlend = 0,
) {
  if (candles.length === 0) return

  const { toX, toY } = layout
  const { bodyW, wickW, radius } = candleDims(layout, candleWidthSecs)
  const halfBody = bodyW / 2
  const padL = layout.pad.left
  const padR = layout.pad.left + layout.chartW

  // Live pulse: subtle brightness cycle
  const livePulse = 0.12 + Math.sin(now_ms * 0.004) * 0.08

  for (const c of candles) {
    const cx = toX(c.time + candleWidthSecs / 2)
    if (cx + halfBody < padL || cx - halfBody > padR) continue

    const isBull = c.close >= c.open
    const isLive = c.time === liveTime
    let color = isLive && liveBullBlend >= 0 ? blendColor(liveBullBlend) : (isBull ? BULL : BEAR)
    if (accentColor && accentBlend > 0.01) {
      color = blendToAccent(color, accentColor, accentBlend)
    }

    // Scrub dimming: smooth spatial gradient from cursor position
    let candleAlpha = isLive ? liveAlpha : 1
    if (scrubDim > 0.01 && scrubX > 0) {
      const dist = cx - scrubX
      if (dist > 0) {
        const fadeZone = bodyW * 1.5
        const dimT = Math.min(dist / fadeZone, 1)
        candleAlpha *= 1 - scrubDim * 0.5 * dimT
      }
    }

    const baseAlpha = ctx.globalAlpha
    ctx.globalAlpha = baseAlpha * candleAlpha

    // Body geometry
    const bodyTop = toY(Math.max(c.open, c.close))
    const bodyBottom = toY(Math.min(c.open, c.close))
    const bodyH = Math.max(1, bodyBottom - bodyTop)

    // Wicks
    const wickTop = toY(c.high)
    const wickBottom = toY(c.low)
    ctx.lineCap = 'round'
    ctx.strokeStyle = color

    if (bodyTop - wickTop > 0.5) {
      ctx.beginPath()
      ctx.moveTo(cx, bodyTop)
      ctx.lineTo(cx, wickTop)
      ctx.lineWidth = wickW
      ctx.stroke()
    }
    if (wickBottom - bodyBottom > 0.5) {
      ctx.beginPath()
      ctx.moveTo(cx, bodyBottom)
      ctx.lineTo(cx, wickBottom)
      ctx.lineWidth = wickW
      ctx.stroke()
    }

    // Body
    ctx.fillStyle = color
    ctx.beginPath()
    roundedRect(ctx, cx - halfBody, bodyTop, bodyW, bodyH, radius)
    ctx.fill()

    // Live candle glow
    if (isLive) {
      ctx.save()
      ctx.globalAlpha = baseAlpha * candleAlpha * livePulse
      ctx.shadowColor = color
      ctx.shadowBlur = 8
      ctx.fillStyle = color
      ctx.beginPath()
      roundedRect(ctx, cx - halfBody, bodyTop, bodyW, bodyH, radius)
      ctx.fill()
      ctx.restore()
    }

    ctx.globalAlpha = baseAlpha
  }
}

/**
 * Draw a dashed horizontal line at the live close price.
 * Dims when scrubbing, uses candle direction color.
 */
export function drawClosePrice(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  palette: LivelinePalette,
  liveCandle: CandlePoint,
  scrubDim: number,
  bullBlend = -1,
) {
  const y = layout.toY(liveCandle.close)
  if (y < layout.pad.top || y > layout.h - layout.pad.bottom) return

  const isBull = liveCandle.close >= liveCandle.open
  const color = bullBlend >= 0 ? blendColor(bullBlend) : (isBull ? BULL : BEAR)

  const baseAlpha = ctx.globalAlpha
  ctx.save()
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.globalAlpha = baseAlpha * (1 - scrubDim * 0.3) * 0.4
  ctx.beginPath()
  ctx.moveTo(layout.pad.left, y)
  ctx.lineTo(layout.w - layout.pad.right, y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

/**
 * Draw candlestick crosshair: vertical line + OHLC tooltip.
 * All elements respect `opacity` for smooth fade in/out.
 */
export function drawCandleCrosshair(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  palette: LivelinePalette,
  hoverX: number,
  candle: CandlePoint,
  hoverTime: number,
  formatValue: (v: number) => string,
  formatTime: (t: number) => string,
  opacity: number,
) {
  if (opacity < 0.01) return

  const { h, pad } = layout

  // Vertical line
  ctx.save()
  ctx.globalAlpha = opacity * 0.5
  ctx.strokeStyle = palette.crosshairLine
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(hoverX, pad.top)
  ctx.lineTo(hoverX, h - pad.bottom)
  ctx.stroke()
  ctx.restore()

  // Tooltip — OHLC + time (matches line chart crosshair patterns)
  if (opacity < 0.1 || layout.w < 300) return

  const isBull = candle.close >= candle.open
  const valueColor = isBull ? BULL : BEAR

  const o = formatValue(candle.open)
  const hi = formatValue(candle.high)
  const lo = formatValue(candle.low)
  const cl = formatValue(candle.close)
  const time = formatTime(hoverTime)

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.font = '400 13px "SF Mono", Menlo, monospace'
  ctx.textAlign = 'left'

  // Build text parts — spacing is embedded in strings so measureText is authoritative.
  // 3 spaces between segments, "  ·  " separator before time.
  const parts: { text: string; color: string }[] = [
    { text: 'O ', color: palette.gridLabel },
    { text: o, color: valueColor },
    { text: '   H ', color: palette.gridLabel },
    { text: hi, color: valueColor },
    { text: '   L ', color: palette.gridLabel },
    { text: lo, color: valueColor },
    { text: '   C ', color: palette.gridLabel },
    { text: cl, color: valueColor },
    { text: '  ·  ', color: palette.gridLabel },
    { text: time, color: palette.gridLabel },
  ]

  // Measure
  let totalW = 0
  const widths: number[] = []
  for (const p of parts) {
    const w = ctx.measureText(p.text).width
    widths.push(w)
    totalW += w
  }

  // Position — center on hover, clamp to chart bounds
  let tx = hoverX - totalW / 2
  const minX = pad.left + 4
  const maxX = layout.w - pad.right - totalW
  if (tx < minX) tx = minX
  if (tx > maxX) tx = maxX
  const ty = pad.top + 24

  // Outline stroke for readability
  ctx.strokeStyle = palette.tooltipBg
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  let cx = tx
  for (let i = 0; i < parts.length; i++) {
    ctx.strokeText(parts[i].text, cx, ty)
    cx += widths[i]
  }

  // Fill text
  cx = tx
  for (let i = 0; i < parts.length; i++) {
    ctx.fillStyle = parts[i].color
    ctx.fillText(parts[i].text, cx, ty)
    cx += widths[i]
  }

  ctx.restore()
}

/**
 * Draw spline + fill through candle close prices (line chart overlay).
 * Fades in with lineModeProg during the candle→line morph.
 * When tickPts + densityProg are provided, cross-blends from the sparse
 * candle-close spline to the high-density tick spline.
 */
export function drawLineOverlay(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  palette: LivelinePalette,
  candles: CandlePoint[],
  candleWidthSecs: number,
  lineModeProg: number,
  scrubX: number,
  scrubDim: number,
  tipX?: number,
  tipY?: number,
  tickPts?: [number, number][],
  densityProg?: number,
) {
  if (candles.length < 2 || lineModeProg < 0.01) return

  const { toX, toY, h, pad, chartW, chartH } = layout

  // Clamp Y to chart bounds (matches real line chart — prevents spline artifacts during range transitions)
  const yMin = pad.top
  const yMax = h - pad.bottom
  const clampY = (y: number) => Math.max(yMin, Math.min(yMax, y))

  const pts: [number, number][] = candles.map(c => [
    toX(c.time + candleWidthSecs / 2),
    clampY(toY(c.close)),
  ])
  if (tipX !== undefined && tipY !== undefined) {
    pts.push([tipX, clampY(tipY)])
  }

  const baseAlpha = ctx.globalAlpha
  const alpha = lineModeProg
  const dp = densityProg ?? 0
  const hasTickPts = tickPts && tickPts.length >= 2

  const renderSpline = (points: [number, number][], a: number) => {
    if (points.length < 2 || a < 0.01) return
    ctx.globalAlpha = baseAlpha * a
    const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom)
    grad.addColorStop(0, palette.fillTop)
    grad.addColorStop(1, palette.fillBottom)
    ctx.beginPath()
    ctx.moveTo(points[0][0], h - pad.bottom)
    ctx.lineTo(points[0][0], points[0][1])
    drawSpline(ctx, points)
    ctx.lineTo(points[points.length - 1][0], h - pad.bottom)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()
    ctx.globalAlpha = baseAlpha * a
    ctx.beginPath()
    ctx.moveTo(points[0][0], points[0][1])
    drawSpline(ctx, points)
    ctx.strokeStyle = palette.line
    ctx.lineWidth = palette.lineWidth
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.globalAlpha = baseAlpha
  }

  const renderOverlay = () => {
    if (dp > 0.01 && hasTickPts) {
      // Single spline through blended tick points — Y values already
      // interpolated between candle-close and real tick by densityProg,
      // so the line smoothly gains detail without any cross-fade.
      renderSpline(tickPts!, alpha)
    } else {
      renderSpline(pts, alpha)
    }
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(pad.left - 1, pad.top, chartW + 2, chartH)
  ctx.clip()

  if (scrubDim > 0.01 && scrubX > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, scrubX, h)
    ctx.clip()
    renderOverlay()
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.rect(scrubX, 0, layout.w - scrubX, h)
    ctx.clip()
    ctx.globalAlpha = baseAlpha * (1 - scrubDim * 0.6)
    renderOverlay()
    ctx.restore()
  } else {
    renderOverlay()
  }

  ctx.restore()
}

/**
 * Simplified crosshair for line mode — single value + time (no OHLC).
 */
export function drawLineModeCrosshair(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  palette: LivelinePalette,
  hoverX: number,
  value: number,
  hoverTime: number,
  formatValue: (v: number) => string,
  formatTime: (t: number) => string,
  opacity: number,
) {
  if (opacity < 0.01) return

  const { h, pad } = layout
  const y = layout.toY(value)

  ctx.save()
  ctx.globalAlpha = opacity * 0.5
  ctx.strokeStyle = palette.crosshairLine
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(hoverX, pad.top)
  ctx.lineTo(hoverX, h - pad.bottom)
  ctx.stroke()

  ctx.globalAlpha = opacity * 0.3
  ctx.beginPath()
  ctx.moveTo(pad.left, y)
  ctx.lineTo(layout.w - pad.right, y)
  ctx.stroke()
  ctx.restore()

  if (opacity < 0.1 || layout.w < 200) return

  const val = formatValue(value)
  const time = formatTime(hoverTime)

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.font = '400 13px "SF Mono", Menlo, monospace'
  ctx.textAlign = 'left'

  const parts: { text: string; color: string }[] = [
    { text: val, color: palette.line },
    { text: '  \u00b7  ', color: palette.gridLabel },
    { text: time, color: palette.gridLabel },
  ]

  let totalW = 0
  const widths: number[] = []
  for (const p of parts) {
    const w = ctx.measureText(p.text).width
    widths.push(w)
    totalW += w
  }

  let tx = hoverX - totalW / 2
  const minX = pad.left + 4
  const maxX = layout.w - pad.right - totalW
  if (tx < minX) tx = minX
  if (tx > maxX) tx = maxX
  const ty = pad.top + 24

  ctx.strokeStyle = palette.tooltipBg
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  let lx = tx
  for (let i = 0; i < parts.length; i++) {
    ctx.strokeText(parts[i].text, lx, ty)
    lx += widths[i]
  }

  lx = tx
  for (let i = 0; i < parts.length; i++) {
    ctx.fillStyle = parts[i].color
    ctx.fillText(parts[i].text, lx, ty)
    lx += widths[i]
  }

  ctx.restore()
}
