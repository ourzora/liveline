import type { LivelinePalette, ChartLayout, LivelinePoint } from '../types'
import { drawSpline } from '../math/spline'

/** Draw the fill gradient + stroke line for a set of points. */
function renderCurve(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  palette: LivelinePalette,
  pts: [number, number][],
  showFill: boolean,
  maxSplinePts: number,
) {
  const { h, pad } = layout

  if (showFill) {
    const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom)
    grad.addColorStop(0, palette.fillTop)
    grad.addColorStop(1, palette.fillBottom)
    ctx.beginPath()
    ctx.moveTo(pts[0][0], h - pad.bottom)
    ctx.lineTo(pts[0][0], pts[0][1])
    drawSpline(ctx, pts, 0.15, maxSplinePts)
    ctx.lineTo(pts[pts.length - 1][0], h - pad.bottom)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()
  }

  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  drawSpline(ctx, pts, 0.15, maxSplinePts)
  ctx.strokeStyle = palette.line
  ctx.lineWidth = palette.lineWidth
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
}

export function drawLine(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  palette: LivelinePalette,
  visible: LivelinePoint[],
  smoothValue: number,
  now: number,
  showFill: boolean,
  scrubX: number | null,
  scrubAmount: number = 0,
) {
  const { w, h, pad, toX, toY, chartW, chartH } = layout

  // Build screen-space points: all historical data stays stable,
  // but the LAST data point uses smoothValue for its Y (so big jumps
  // animate smoothly instead of snapping). Its X stays at the original
  // data time (stable, no per-frame drift — this is what killed jitter).
  // Then append the live tip at (now, smoothValue).
  // Y coordinates are clamped to chart bounds so the line hugs the edge
  // during range transitions instead of getting hard-clipped.
  const yMin = pad.top
  const yMax = h - pad.bottom
  const clampY = (y: number) => Math.max(yMin, Math.min(yMax, y))
  const pts: [number, number][] = visible.map((p, i) =>
    i === visible.length - 1
      ? [toX(p.time), clampY(toY(smoothValue))]
      : [toX(p.time), clampY(toY(p.value))]
  )
  pts.push([toX(now), clampY(toY(smoothValue))])

  if (pts.length < 2) return

  const isScrubbing = scrubX !== null

  // Max spline segments = chart width in px (1 bezier per pixel).
  // Prevents index-based downsampling jitter on dense windows (5min+)
  // while still reducing for extreme cases (1-week).
  const maxSplinePts = Math.max(300, Math.ceil(chartW))

  // Clip line + fill to chart area — during big value jumps the range
  // lerps smoothly so the line may extend beyond the chart bounds.
  // Clipping keeps it tidy while the range catches up.
  ctx.save()
  ctx.beginPath()
  ctx.rect(pad.left - 1, pad.top, chartW + 2, chartH)
  ctx.clip()

  if (isScrubbing) {
    // Full-opacity portion: clipped to LEFT of scrub point
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, scrubX!, h)
    ctx.clip()
    renderCurve(ctx, layout, palette, pts, showFill, maxSplinePts)
    ctx.restore()

    // Dimmed portion: clipped to RIGHT of scrub point
    ctx.save()
    ctx.beginPath()
    ctx.rect(scrubX!, 0, layout.w - scrubX!, h)
    ctx.clip()
    ctx.globalAlpha = 1 - scrubAmount * 0.6
    renderCurve(ctx, layout, palette, pts, showFill, maxSplinePts)
    ctx.restore()
  } else {
    renderCurve(ctx, layout, palette, pts, showFill, maxSplinePts)
  }

  // Restore from chart-area clip
  ctx.restore()

  // Dashed current-price line (clamped to chart bounds)
  const currentY = Math.max(pad.top, Math.min(h - pad.bottom, toY(smoothValue)))
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = palette.dashLine
  ctx.lineWidth = 1
  if (isScrubbing) ctx.globalAlpha = 1 - scrubAmount * 0.2
  ctx.beginPath()
  ctx.moveTo(pad.left, currentY)
  ctx.lineTo(layout.w - pad.right, currentY)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1

  // Clamp last point Y so dot stays within canvas (not chart area).
  // The dot outer circle is 6.5px + shadow — 10px margin keeps it visible.
  const last = pts[pts.length - 1]
  last[1] = Math.max(10, Math.min(h - 10, last[1]))

  return pts
}
