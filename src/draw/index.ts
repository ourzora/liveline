import type { LivelinePalette, ChartLayout, LivelinePoint, Momentum, ReferenceLine, OrderbookData, DegenOptions } from '../types'
import { drawGrid, type GridState } from './grid'
import { drawLine } from './line'
import { drawDot, drawArrows } from './dot'
import { drawCrosshair } from './crosshair'
import { drawReferenceLine } from './referenceLine'
import { drawTimeAxis, type TimeAxisState } from './timeAxis'
import { drawOrderbook, type OrderbookState } from './orderbook'
import { drawParticles, spawnOnSwing, type ParticleState } from './particles'

// Constants
const SHAKE_DECAY_RATE = 0.002
const SHAKE_MIN_AMPLITUDE = 0.2
const FADE_EDGE_WIDTH = 40
const CROSSHAIR_FADE_MIN_PX = 5

export interface ArrowState { up: number; down: number }

export interface ShakeState {
  amplitude: number  // current shake magnitude in px, decays each frame
}

export function createShakeState(): ShakeState {
  return { amplitude: 0 }
}

export interface DrawOptions {
  visible: LivelinePoint[]
  smoothValue: number
  now: number  // engine's Date.now()/1000, single timestamp for the frame
  momentum: Momentum
  arrowState: ArrowState
  showGrid: boolean
  showMomentum: boolean
  showPulse: boolean
  showFill: boolean
  referenceLine?: ReferenceLine
  hoverX: number | null
  hoverValue: number | null
  hoverTime: number | null
  scrubAmount: number // 0 = not scrubbing, 1 = fully scrubbing (lerped)
  windowSecs: number
  formatValue: (v: number) => string
  formatTime: (t: number) => string
  gridState: GridState
  timeAxisState: TimeAxisState
  dt: number // delta time in ms for frame-rate-independent lerps
  targetWindowSecs: number // final target window (stable during transitions)
  tooltipY: number
  tooltipOutline: boolean
  orderbookData?: OrderbookData
  orderbookState?: OrderbookState
  particleState?: ParticleState
  particleOptions?: DegenOptions
  swingMagnitude: number
  shakeState?: ShakeState
}

/**
 * Master draw function — calls each draw module in order.
 * Mutates arrowState in place.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  palette: LivelinePalette,
  opts: DrawOptions,
): void {
  // 0. Chart shake — apply offset, decay amplitude
  const shake = opts.shakeState
  let shakeX = 0
  let shakeY = 0
  if (shake && shake.amplitude > SHAKE_MIN_AMPLITUDE) {
    shakeX = (Math.random() - 0.5) * 2 * shake.amplitude
    shakeY = (Math.random() - 0.5) * 2 * shake.amplitude
    ctx.save()
    ctx.translate(shakeX, shakeY)
  }
  if (shake) {
    // Exponential decay — ~200ms of visible shake
    const decayRate = Math.pow(SHAKE_DECAY_RATE, opts.dt / 1000)
    shake.amplitude *= decayRate
    if (shake.amplitude < SHAKE_MIN_AMPLITUDE) shake.amplitude = 0
  }

  // 1. Reference line (behind everything)
  if (opts.referenceLine) {
    drawReferenceLine(ctx, layout, palette, opts.referenceLine)
  }

  // 2. Grid
  if (opts.showGrid) {
    drawGrid(ctx, layout, palette, opts.formatValue, opts.gridState, opts.dt)
  }

  // 2b. Orderbook (behind line)
  if (opts.orderbookData && opts.orderbookState) {
    drawOrderbook(ctx, layout, palette, opts.orderbookData, opts.dt, opts.orderbookState, opts.swingMagnitude)
  }

  // 3. Line + fill (with scrub dimming)
  // Pass scrubX only when scrub is active enough to be visible
  const scrubX = opts.scrubAmount > 0.05 ? opts.hoverX : null
  const pts = drawLine(ctx, layout, palette, opts.visible, opts.smoothValue, opts.now, opts.showFill, scrubX, opts.scrubAmount)

  // 4. Time axis
  drawTimeAxis(ctx, layout, palette, opts.windowSecs, opts.targetWindowSecs, opts.formatTime, opts.timeAxisState, opts.dt)

  if (pts && pts.length > 0) {
    const lastPt = pts[pts.length - 1]

    // 5. Dot — dims during scrub, returns to full opacity near the live dot
    let dotScrub = opts.scrubAmount
    if (opts.hoverX !== null && dotScrub > 0) {
      const distToLive = lastPt[0] - opts.hoverX
      const fadeStart = Math.min(80, layout.chartW * 0.3)
      dotScrub = distToLive < CROSSHAIR_FADE_MIN_PX ? 0
        : distToLive >= fadeStart ? opts.scrubAmount
        : ((distToLive - CROSSHAIR_FADE_MIN_PX) / (fadeStart - CROSSHAIR_FADE_MIN_PX)) * opts.scrubAmount
    }
    drawDot(ctx, lastPt[0], lastPt[1], palette, opts.showPulse, dotScrub)
    if (opts.showMomentum) {
      drawArrows(
        ctx, lastPt[0], lastPt[1],
        opts.momentum, palette, opts.arrowState, opts.dt,
      )
    }

    // 6. Particles — spawn on large swings at the live dot
    if (opts.particleState) {
      const burstIntensity = spawnOnSwing(
        opts.particleState, opts.momentum, lastPt[0], lastPt[1],
        opts.swingMagnitude, palette.line, opts.dt, opts.particleOptions,
      )
      if (burstIntensity > 0 && shake) {
        shake.amplitude = (3 + opts.swingMagnitude * 4) * burstIntensity
      }
      drawParticles(ctx, opts.particleState, opts.dt)
    }
  }

  // 7. Left edge fade — gradient erase
  const fadeW = FADE_EDGE_WIDTH
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  const fadeGrad = ctx.createLinearGradient(layout.pad.left, 0, layout.pad.left + fadeW, 0)
  fadeGrad.addColorStop(0, 'rgba(0, 0, 0, 1)')
  fadeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = fadeGrad
  ctx.fillRect(0, 0, layout.pad.left + fadeW, layout.h)
  ctx.restore()

  // 8. Crosshair — fade out well before reaching live dot
  if (opts.hoverX !== null && opts.hoverValue !== null && opts.hoverTime !== null && pts && pts.length > 0) {
    const lastPt = pts[pts.length - 1]
    const distToLive = lastPt[0] - opts.hoverX
    const fadeStart = Math.min(80, layout.chartW * 0.3)
    const scrubOpacity = distToLive < CROSSHAIR_FADE_MIN_PX ? 0
      : distToLive >= fadeStart ? opts.scrubAmount
      : ((distToLive - CROSSHAIR_FADE_MIN_PX) / (fadeStart - CROSSHAIR_FADE_MIN_PX)) * opts.scrubAmount

    if (scrubOpacity > 0.01) {
      drawCrosshair(
        ctx, layout, palette,
        opts.hoverX, opts.hoverValue, opts.hoverTime,
        opts.formatValue, opts.formatTime,
        scrubOpacity,
        opts.tooltipY,
        lastPt[0], // liveDotX — tooltip right edge stops here
        opts.tooltipOutline,
      )
    }
  }

  // Restore shake translate
  if (shake && (shakeX !== 0 || shakeY !== 0)) {
    ctx.restore()
  }
}
