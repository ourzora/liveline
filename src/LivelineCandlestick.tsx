import { useRef, useEffect, useCallback, useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { ThemeMode, Padding, ChartLayout, LivelinePoint } from './types'
import { computeRange } from './math/range'
import { resolveTheme } from './theme'
import { getDpr, applyDpr } from './canvas/dpr'
import { drawGrid, type GridState } from './draw/grid'
import { drawTimeAxis, type TimeAxisState } from './draw/timeAxis'
import { drawCandlesticks, drawClosePrice, drawCandleCrosshair, drawLineOverlay, drawLineModeCrosshair, type CandlePoint } from './draw/candlestick'
import { drawEmpty } from './draw/empty'
import { drawLoading } from './draw/loading'
import { loadingY, LOADING_AMPLITUDE_RATIO, LOADING_SCROLL_SPEED } from './draw/loadingShape'
import { drawDot } from './draw/dot'
import { lerp } from './math/lerp'
import { FADE_EDGE_WIDTH } from './draw'

export type { CandlePoint } from './draw/candlestick'

// --- Props ---

export interface LivelineCandlestickProps {
  candles: CandlePoint[]
  /** Width of each candle in seconds (e.g. 1 for 1s candles, 5 for 5s) */
  candleWidth: number
  /** Current live candle — updates in real-time as new ticks arrive */
  liveCandle?: CandlePoint

  /** Show loading animation (breathing line) while waiting for data */
  loading?: boolean
  /** Freeze the chart — time stops, data is snapshotted, chart decelerates smoothly */
  paused?: boolean
  /** Custom text for the empty/no-data state (default "No data to display") */
  emptyText?: string
  /** When true, morphs candlestick display into a line chart (spline through close prices) */
  lineMode?: boolean
  /** Tick-level data for high-density line mode — after morph, line gains detail from this data */
  lineData?: LivelinePoint[]
  /** Current live value for the tick-level data stream */
  lineValue?: number

  theme?: ThemeMode
  color?: string
  window?: number
  grid?: boolean
  scrub?: boolean

  formatValue?: (v: number) => string
  formatTime?: (t: number) => string
  padding?: Padding
  cursor?: string

  className?: string
  style?: CSSProperties
}

// --- Range computation ---

function computeCandleRange(
  candles: CandlePoint[],
): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity

  for (const c of candles) {
    if (c.low < min) min = c.low
    if (c.high > max) max = c.high
  }

  if (!isFinite(min) || !isFinite(max)) return { min: 99, max: 101 }

  const range = max - min
  const margin = range * 0.12
  const minRange = range * 0.1 || 0.4
  if (range < minRange) {
    const mid = (min + max) / 2
    return { min: mid - minRange / 2, max: mid + minRange / 2 }
  }
  return { min: min - margin, max: max + margin }
}

function computeCloseRange(
  candles: CandlePoint[],
  smoothClose?: number,
): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity

  for (const c of candles) {
    if (c.close < min) min = c.close
    if (c.close > max) max = c.close
  }

  // Include smooth value in range (matches real engine's computeRange)
  if (smoothClose !== undefined) {
    if (smoothClose < min) min = smoothClose
    if (smoothClose > max) max = smoothClose
  }

  if (!isFinite(min) || !isFinite(max)) return { min: 99, max: 101 }

  const range = max - min
  const margin = range * 0.12
  const minRange = range * 0.1 || 0.4
  if (range < minRange) {
    const mid = (min + max) / 2
    return { min: mid - minRange / 2, max: mid + minRange / 2 }
  }
  return { min: min - margin, max: max + margin }
}

// --- Hover: find candle at pixel X ---

function candleAtX(
  candles: CandlePoint[],
  hoverX: number,
  candleWidth: number,
  layout: ChartLayout,
): CandlePoint | null {
  const time = layout.leftEdge + ((hoverX - layout.pad.left) / layout.chartW) * (layout.rightEdge - layout.leftEdge)
  let lo = 0
  let hi = candles.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = candles[mid]
    if (time < c.time) hi = mid - 1
    else if (time >= c.time + candleWidth) lo = mid + 1
    else return c
  }
  return null
}

// --- Default formatters ---

const defaultFormatValue = (v: number) => v.toFixed(2)
const defaultFormatTime = (t: number) => {
  const d = new Date(t * 1000)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

// --- Window transition state ---

interface WindowTransState {
  from: number
  to: number
  startMs: number
  rangeFromMin: number
  rangeFromMax: number
  rangeToMin: number
  rangeToMax: number
}

// --- Animation constants (matched to line chart engine) ---

const MAX_DELTA_MS = 50
const BUFFER = 0.05
const RANGE_LERP_SPEED = 0.15
const RANGE_ADAPTIVE_BOOST = 0.2
const CANDLE_LERP_SPEED = 0.25
const SCRUB_LERP_SPEED = 0.12
// Adaptive value lerp — matches real Liveline engine (useLivelineEngine.ts)
const LINE_LERP_BASE = 0.08
const LINE_ADAPTIVE_BOOST = 0.2
const LINE_SNAP_THRESHOLD = 0.001
const WINDOW_TRANSITION_MS = 750
const CANDLE_WIDTH_TRANS_MS = 300
const CHART_REVEAL_SPEED = 0.14
const LOADING_ALPHA_SPEED = 0.14
const PAUSE_PROGRESS_SPEED = 0.12
const PAUSE_CATCHUP_SPEED = 0.08
const PAUSE_CATCHUP_SPEED_FAST = 0.22
const LINE_MORPH_MS = 500
const LINE_DENSITY_MS = 350

// --- Extracted pure functions (match useLivelineEngine patterns) ---

/** Update window transition state, returning current display window and transition progress. */
function updateWindowTransition(
  targetWindowSecs: number,
  wt: WindowTransState,
  displayWindow: number,
  displayMin: number,
  displayMax: number,
  now_ms: number,
  now: number,
  candles: CandlePoint[],
  liveCandle: CandlePoint | undefined,
  candleWidth: number,
  buffer: number,
): { windowSecs: number; windowTransProgress: number } {
  if (wt.to !== targetWindowSecs) {
    wt.from = displayWindow
    wt.to = targetWindowSecs
    wt.startMs = now_ms
    wt.rangeFromMin = displayMin
    wt.rangeFromMax = displayMax
    // Pre-compute target range for the destination window
    const targetRightEdge = now + targetWindowSecs * buffer
    const targetLeftEdge = targetRightEdge - targetWindowSecs
    const targetVisible: CandlePoint[] = []
    for (const c of candles) {
      if (c.time + candleWidth >= targetLeftEdge && c.time <= targetRightEdge) {
        targetVisible.push(c)
      }
    }
    if (liveCandle && liveCandle.time + candleWidth >= targetLeftEdge && liveCandle.time <= targetRightEdge) {
      targetVisible.push(liveCandle)
    }
    if (targetVisible.length > 0) {
      const tr = computeCandleRange(targetVisible)
      wt.rangeToMin = tr.min
      wt.rangeToMax = tr.max
    }
  }

  let windowTransProgress = 0
  let resultWindow: number
  if (wt.startMs === 0) {
    resultWindow = targetWindowSecs
  } else {
    const elapsed = now_ms - wt.startMs
    const t = Math.min(elapsed / WINDOW_TRANSITION_MS, 1)
    const eased = (1 - Math.cos(t * Math.PI)) / 2
    windowTransProgress = eased
    const logFrom = Math.log(wt.from)
    const logTo = Math.log(wt.to)
    resultWindow = Math.exp(logFrom + (logTo - logFrom) * eased)
    if (t >= 1) {
      resultWindow = targetWindowSecs
      wt.startMs = 0
      windowTransProgress = 0
    }
  }

  return { windowSecs: resultWindow, windowTransProgress }
}

/** Smooth Y range with lerp. During window transitions, interpolates between pre-computed ranges. */
function updateCandleRange(
  computedRange: { min: number; max: number },
  rangeInited: boolean,
  displayMin: number,
  displayMax: number,
  isTransitioning: boolean,
  windowTransProgress: number,
  wt: WindowTransState,
  chartH: number,
  dt: number,
): { minVal: number; maxVal: number; valRange: number; displayMin: number; displayMax: number; rangeInited: boolean } {
  if (!rangeInited) {
    return {
      minVal: computedRange.min, maxVal: computedRange.max,
      valRange: (computedRange.max - computedRange.min) || 0.001,
      displayMin: computedRange.min, displayMax: computedRange.max,
      rangeInited: true,
    }
  }

  if (isTransitioning) {
    displayMin = wt.rangeFromMin + (wt.rangeToMin - wt.rangeFromMin) * windowTransProgress
    displayMax = wt.rangeFromMax + (wt.rangeToMax - wt.rangeFromMax) * windowTransProgress
  } else {
    // Adaptive speed — when range delta is small, settle faster
    const curRange = displayMax - displayMin || 1
    const gapMin = Math.abs(displayMin - computedRange.min)
    const gapMax = Math.abs(displayMax - computedRange.max)
    const gapRatio = Math.min((gapMin + gapMax) / curRange, 1)
    const speed = RANGE_LERP_SPEED + (1 - gapRatio) * RANGE_ADAPTIVE_BOOST

    displayMin = lerp(displayMin, computedRange.min, speed, dt)
    displayMax = lerp(displayMax, computedRange.max, speed, dt)
    // Snap when close to avoid sub-pixel jitter
    const pxThreshold = 0.5 * curRange / chartH || 0.001
    if (Math.abs(displayMin - computedRange.min) < pxThreshold) displayMin = computedRange.min
    if (Math.abs(displayMax - computedRange.max) < pxThreshold) displayMax = computedRange.max
  }

  return {
    minVal: displayMin, maxVal: displayMax,
    valRange: (displayMax - displayMin) || 0.001,
    displayMin, displayMax,
    rangeInited: true,
  }
}

// --- Component ---

export function LivelineCandlestick({
  candles,
  candleWidth,
  liveCandle,
  loading = false,
  paused = false,
  emptyText,
  lineMode = false,
  lineData,
  lineValue,
  theme = 'dark',
  color = '#3b82f6',
  window: windowSecs = 60,
  grid = true,
  scrub = true,
  formatValue = defaultFormatValue,
  formatTime = defaultFormatTime,
  padding: paddingOverride,
  cursor = 'crosshair',
  className,
  style,
}: LivelineCandlestickProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const palette = useMemo(() => resolveTheme(color, theme), [color, theme])

  const pad = useMemo(() => ({
    top: paddingOverride?.top ?? 12,
    right: paddingOverride?.right ?? 60,
    bottom: paddingOverride?.bottom ?? 28,
    left: paddingOverride?.left ?? 12,
  }), [paddingOverride])

  // Config ref — avoids recreating draw loop
  const configRef = useRef({ candles, candleWidth, liveCandle, loading, paused, emptyText, lineMode, lineData, lineValue, windowSecs, grid, scrub, formatValue, formatTime, palette, pad })
  configRef.current = { candles, candleWidth, liveCandle, loading, paused, emptyText, lineMode, lineData, lineValue, windowSecs, grid, scrub, formatValue, formatTime, palette, pad }

  // --- Canvas + sizing ---
  const sizeRef = useRef({ w: 0, h: 0 })
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const rafRef = useRef(0)
  const lastFrameRef = useRef(0)

  // --- Window transition ---
  const displayWindowRef = useRef(windowSecs)
  const windowTransRef = useRef<WindowTransState>({
    from: windowSecs, to: windowSecs, startMs: 0,
    rangeFromMin: 0, rangeFromMax: 0, rangeToMin: 0, rangeToMax: 0,
  })

  // --- Live candle smooth morphing ---
  const displayCandleRef = useRef<CandlePoint | null>(null)
  const liveBirthAlphaRef = useRef(1)
  const liveBullRef = useRef(0.5) // 0 = bear, 1 = bull — lerped for smooth color blend

  // --- Range animation ---
  const displayMinRef = useRef(0)
  const displayMaxRef = useRef(0)
  const rangeInitedRef = useRef(false)

  // --- Grid/axis persistent state ---
  const gridStateRef = useRef<GridState>({ interval: 0, labels: new Map() })
  const timeAxisStateRef = useRef<TimeAxisState>({ labels: new Map() })

  // --- Hover/scrub animation ---
  const hoverXRef = useRef<number | null>(null)
  const scrubAmountRef = useRef(0)
  const lastHoverRef = useRef<{
    x: number; time: number; candle: CandlePoint
  } | null>(null)

  // --- Loading + reveal ---
  const loadingAlphaRef = useRef(loading ? 1 : 0)
  const chartRevealRef = useRef(0)

  // --- Pause state ---
  const pauseProgressRef = useRef(0) // 0 = playing, 1 = fully paused
  const timeDebtRef = useRef(0)      // accumulated seconds behind real time
  const pausedCandlesRef = useRef<CandlePoint[] | null>(null)
  const pausedLiveRef = useRef<CandlePoint | null>(null)
  // Data stash for reverse morph (chart → flat line when data disappears)
  const lastCandlesRef = useRef<CandlePoint[]>([])
  const lastLiveRef = useRef<CandlePoint | null>(null)

  // --- Line mode morph ---
  const lineModeProgRef = useRef(0)
  const lineModeTransRef = useRef<{ startMs: number; from: number; to: number }>({ startMs: 0, from: 0, to: 0 })
  // Smooth close that spans candle transitions — never resets on birth
  const lineSmoothCloseRef = useRef(0)
  const lineSmoothInitedRef = useRef(false)
  // --- Line density transition (candle-close spline → tick-data spline) ---
  const lineDensityProgRef = useRef(0)
  const lineDensityTransRef = useRef<{ startMs: number; from: number; to: number }>({ startMs: 0, from: 0, to: 0 })
  const lineTickSmoothRef = useRef(0)
  const lineTickSmoothInitedRef = useRef(false)

  // --- Candle width transition ---
  const displayCandleWidthRef = useRef(candleWidth)
  const candleWidthTransRef = useRef<{
    fromWidth: number; toWidth: number; startMs: number
    rangeFromMin: number; rangeFromMax: number; rangeToMin: number; rangeToMax: number
    oldCandles: CandlePoint[]; oldWidth: number
  }>({
    fromWidth: candleWidth, toWidth: candleWidth, startMs: 0,
    rangeFromMin: 0, rangeFromMax: 0, rangeToMin: 0, rangeToMax: 0,
    oldCandles: [], oldWidth: candleWidth,
  })
  const prevCandleDataRef = useRef({ candles, width: candleWidth })

  // --- ResizeObserver ---
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      sizeRef.current = { w: entry.contentRect.width, h: entry.contentRect.height }
    })
    ro.observe(container)
    const rect = container.getBoundingClientRect()
    sizeRef.current = { w: rect.width, h: rect.height }
    return () => ro.disconnect()
  }, [])

  // --- Mouse + touch events ---
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onMove = (e: MouseEvent) => {
      if (!configRef.current.scrub) return
      const rect = container.getBoundingClientRect()
      hoverXRef.current = e.clientX - rect.left
    }
    const onLeave = () => { hoverXRef.current = null }
    const onTouchStart = (e: TouchEvent) => {
      if (!configRef.current.scrub || e.touches.length !== 1) return
      const rect = container.getBoundingClientRect()
      hoverXRef.current = e.touches[0].clientX - rect.left
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!configRef.current.scrub || e.touches.length !== 1) return
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      hoverXRef.current = e.touches[0].clientX - rect.left
    }
    const onTouchEnd = () => { hoverXRef.current = null }

    container.addEventListener('mousemove', onMove)
    container.addEventListener('mouseleave', onLeave)
    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd)
    container.addEventListener('touchcancel', onTouchEnd)
    return () => {
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseleave', onLeave)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  // --- rAF draw loop ---
  const draw = useCallback(() => {
    if (document.hidden) { rafRef.current = 0; return }

    const canvas = canvasRef.current
    const { w, h } = sizeRef.current
    if (!canvas || w === 0 || h === 0) {
      rafRef.current = requestAnimationFrame(draw)
      return
    }

    const cfg = configRef.current
    const dpr = getDpr()
    const now_ms = performance.now()
    const dt = lastFrameRef.current ? Math.min(now_ms - lastFrameRef.current, MAX_DELTA_MS) : 16.67
    lastFrameRef.current = now_ms

    // Canvas resize
    const targetW = Math.round(w * dpr)
    const targetH = Math.round(h * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }

    let ctx = ctxRef.current
    if (!ctx || ctx.canvas !== canvas) {
      ctx = canvas.getContext('2d')
      ctxRef.current = ctx
    }
    if (!ctx) { rafRef.current = requestAnimationFrame(draw); return }

    applyDpr(ctx, dpr, w, h)

    const { pad: p } = cfg
    const chartW = w - p.left - p.right
    const chartH = h - p.top - p.bottom

    // --- Pause time management (matches line chart engine) ---
    // Snapshot data when pause starts so consumer-side pruning can't erode visible candles
    if (cfg.paused && pausedCandlesRef.current === null && cfg.candles.length > 0) {
      pausedCandlesRef.current = cfg.candles.slice()
      pausedLiveRef.current = cfg.liveCandle ?? null
    }
    if (!cfg.paused) {
      pausedCandlesRef.current = null
      pausedLiveRef.current = null
    }

    const pauseTarget = cfg.paused ? 1 : 0
    pauseProgressRef.current = lerp(pauseProgressRef.current, pauseTarget, PAUSE_PROGRESS_SPEED, dt)
    if (pauseProgressRef.current < 0.005) pauseProgressRef.current = 0
    if (pauseProgressRef.current > 0.995) pauseProgressRef.current = 1
    const pauseProgress = pauseProgressRef.current
    const pausedDt = dt * (1 - pauseProgress)

    const realDtSec = dt / 1000
    timeDebtRef.current += realDtSec * pauseProgress
    if (!cfg.paused && timeDebtRef.current > 0.001) {
      const catchUpSpeed = timeDebtRef.current > 10
        ? PAUSE_CATCHUP_SPEED_FAST
        : PAUSE_CATCHUP_SPEED
      timeDebtRef.current = lerp(timeDebtRef.current, 0, catchUpSpeed, dt)
      if (timeDebtRef.current < 0.01) timeDebtRef.current = 0
    }

    const now = Date.now() / 1000 - timeDebtRef.current

    // Use paused snapshot when paused, otherwise live data
    const effectiveCandles = pausedCandlesRef.current ?? cfg.candles
    const rawLive = pausedCandlesRef.current ? (pausedLiveRef.current ?? undefined) : cfg.liveCandle

    // --- Candle width morph transition (position + OHLC + width) ---
    const cwt = candleWidthTransRef.current

    // Compute current morph state from any active transition
    let morphT = -1  // -1 = no transition, 0..1 = active
    let displayCandleWidth: number
    if (cwt.startMs > 0) {
      const elapsed = now_ms - cwt.startMs
      const t = Math.min(elapsed / CANDLE_WIDTH_TRANS_MS, 1)
      morphT = (1 - Math.cos(t * Math.PI)) / 2
      displayCandleWidth = Math.exp(
        Math.log(cwt.fromWidth) + (Math.log(cwt.toWidth) - Math.log(cwt.fromWidth)) * morphT,
      )
      if (t >= 1) {
        displayCandleWidth = cwt.toWidth
        cwt.startMs = 0
        morphT = -1
      }
    } else {
      displayCandleWidth = cwt.toWidth
    }

    // Detect new width change — start (or restart) width transition
    if (cfg.candleWidth !== cwt.toWidth) {
      // Snapshot previous candle data for cross-fade out
      cwt.oldCandles = prevCandleDataRef.current.candles
      cwt.oldWidth = prevCandleDataRef.current.width
      cwt.fromWidth = displayCandleWidth
      cwt.toWidth = cfg.candleWidth
      cwt.startMs = now_ms
      morphT = 0
      // Capture current Y range for smooth interpolation (matches window transition pattern)
      cwt.rangeFromMin = displayMinRef.current
      cwt.rangeFromMax = displayMaxRef.current
      // Pre-compute target Y range from new candle data
      const curWindow = displayWindowRef.current
      const re = now + curWindow * BUFFER
      const le = re - curWindow
      const targetVisible: CandlePoint[] = []
      for (const c of effectiveCandles) {
        if (c.time + cfg.candleWidth >= le && c.time <= re) {
          targetVisible.push(c)
        }
      }
      if (rawLive) targetVisible.push(rawLive)
      if (targetVisible.length > 0) {
        const tr = computeCandleRange(targetVisible)
        cwt.rangeToMin = tr.min
        cwt.rangeToMax = tr.max
      } else {
        cwt.rangeToMin = displayMinRef.current
        cwt.rangeToMax = displayMaxRef.current
      }
    }
    displayCandleWidthRef.current = displayCandleWidth
    prevCandleDataRef.current = { candles: cfg.candles, width: cfg.candleWidth }

    // --- Line mode morph transition (timed, cosine easing) ---
    const lmt = lineModeTransRef.current
    const lineModeTarget = cfg.lineMode ? 1 : 0
    // No hold on reverse — morph and density collapse run in parallel
    if (lmt.to !== lineModeTarget) {
      lmt.from = lineModeProgRef.current
      lmt.to = lineModeTarget
      lmt.startMs = now_ms
    }
    let lineModeProg: number
    if (lmt.startMs > 0) {
      const elapsed = now_ms - lmt.startMs
      const t = Math.min(elapsed / LINE_MORPH_MS, 1)
      lineModeProg = lmt.from + (lmt.to - lmt.from) * ((1 - Math.cos(t * Math.PI)) / 2)
      if (t >= 1) { lineModeProg = lmt.to; lmt.startMs = 0 }
    } else {
      lineModeProg = lmt.to
    }
    lineModeProgRef.current = lineModeProg

    // --- Line density transition (sparse candle-close → full tick data) ---
    const ldt = lineDensityTransRef.current
    const hasTickData = cfg.lineData && cfg.lineData.length > 0
    const densityTarget = (cfg.lineMode && lineModeProg >= 0.3 && hasTickData) ? 1 : 0
    if (ldt.to !== densityTarget) {
      ldt.from = lineDensityProgRef.current
      ldt.to = densityTarget
      ldt.startMs = now_ms
    }
    let lineDensityProg: number
    if (ldt.startMs > 0) {
      const elapsed = now_ms - ldt.startMs
      const t = Math.min(elapsed / LINE_DENSITY_MS, 1)
      lineDensityProg = ldt.from + (ldt.to - ldt.from) * (1 - (1 - t) * (1 - t))
      if (t >= 1) { lineDensityProg = ldt.to; ldt.startMs = 0 }
    } else {
      lineDensityProg = ldt.to
    }
    lineDensityProgRef.current = lineDensityProg

    // --- Window transition (matches line chart engine exactly) ---
    const wt = windowTransRef.current
    const windowResult = updateWindowTransition(
      cfg.windowSecs, wt, displayWindowRef.current,
      displayMinRef.current, displayMaxRef.current,
      now_ms, now, effectiveCandles, rawLive, cfg.candleWidth, BUFFER,
    )
    displayWindowRef.current = windowResult.windowSecs
    const effectiveWindow = windowResult.windowSecs
    const windowTransProgress = windowResult.windowTransProgress
    const isWindowTransitioning = wt.startMs > 0

    const rightEdge = now + effectiveWindow * BUFFER
    const leftEdge = rightEdge - effectiveWindow

    // --- Lerp live candle OHLC for smooth shape morphing ---
    let smoothLive: CandlePoint | undefined
    if (rawLive) {
      const prev = displayCandleRef.current
      if (!prev || prev.time !== rawLive.time) {
        // New candle period — start birth animation
        // Initialize display at open price (zero-height candle) so it grows from a point
        displayCandleRef.current = {
          time: rawLive.time,
          open: rawLive.open,
          high: rawLive.open,
          low: rawLive.open,
          close: rawLive.open,
        }
        liveBirthAlphaRef.current = 0
      } else {
        // Same candle — lerp ALL values including high/low for smooth wick extension
        // Use pausedDt so lerps decelerate smoothly when pausing
        const dc = displayCandleRef.current!
        dc.open = lerp(dc.open, rawLive.open, CANDLE_LERP_SPEED, pausedDt)
        dc.high = lerp(dc.high, rawLive.high, CANDLE_LERP_SPEED, pausedDt)
        dc.low = lerp(dc.low, rawLive.low, CANDLE_LERP_SPEED, pausedDt)
        dc.close = lerp(dc.close, rawLive.close, CANDLE_LERP_SPEED, pausedDt)
      }
      // Birth fade-in
      liveBirthAlphaRef.current = lerp(liveBirthAlphaRef.current, 1, 0.2, pausedDt)
      if (liveBirthAlphaRef.current > 0.99) liveBirthAlphaRef.current = 1
      // Smooth color transition: lerp bull amount (0=bear, 1=bull)
      const dc = displayCandleRef.current!
      const bullTarget = dc.close >= dc.open ? 1 : 0
      liveBullRef.current = lerp(liveBullRef.current, bullTarget, 0.12, pausedDt)
      if (liveBullRef.current > 0.99) liveBullRef.current = 1
      if (liveBullRef.current < 0.01) liveBullRef.current = 0
      smoothLive = dc
    } else {
      displayCandleRef.current = null
      liveBirthAlphaRef.current = 1
      liveBullRef.current = 0.5
    }

    // Smooth close for line mode — lerps toward raw close, never resets on candle birth.
    // Uses adaptive speed matching the real Liveline engine: slow for big jumps, fast for
    // small ticks. This makes the line tip track naturally instead of at candle-lerp speed.
    if (rawLive) {
      if (!lineSmoothInitedRef.current) {
        lineSmoothCloseRef.current = rawLive.close
        lineSmoothInitedRef.current = true
      } else {
        const valGap = Math.abs(rawLive.close - lineSmoothCloseRef.current)
        const prevRange = displayMaxRef.current - displayMinRef.current || 1
        const gapRatio = Math.min(valGap / prevRange, 1)
        const adaptiveSpeed = LINE_LERP_BASE + (1 - gapRatio) * LINE_ADAPTIVE_BOOST
        lineSmoothCloseRef.current = lerp(lineSmoothCloseRef.current, rawLive.close, adaptiveSpeed, pausedDt)
        // Snap when close to target (prevents endless micro-lerping)
        if (valGap < prevRange * LINE_SNAP_THRESHOLD) {
          lineSmoothCloseRef.current = rawLive.close
        }
      }
    } else {
      lineSmoothInitedRef.current = false
    }

    // Smooth tick value for density transition — same adaptive lerp pattern
    if (cfg.lineValue !== undefined && hasTickData) {
      if (!lineTickSmoothInitedRef.current) {
        lineTickSmoothRef.current = cfg.lineValue
        lineTickSmoothInitedRef.current = true
      } else {
        const valGap = Math.abs(cfg.lineValue - lineTickSmoothRef.current)
        const prevRange = displayMaxRef.current - displayMinRef.current || 1
        const gapRatio = Math.min(valGap / prevRange, 1)
        const adaptiveSpeed = LINE_LERP_BASE + (1 - gapRatio) * LINE_ADAPTIVE_BOOST
        lineTickSmoothRef.current = lerp(lineTickSmoothRef.current, cfg.lineValue, adaptiveSpeed, pausedDt)
        if (valGap < prevRange * LINE_SNAP_THRESHOLD) {
          lineTickSmoothRef.current = cfg.lineValue
        }
      }
    } else {
      lineTickSmoothInitedRef.current = false
    }

    // --- Build visible candles ---
    const visible: CandlePoint[] = []
    for (const c of effectiveCandles) {
      if (c.time + cfg.candleWidth >= leftEdge && c.time <= rightEdge) {
        visible.push(c)
      }
    }
    // Always add live candle (handled by its own lerp system)
    if (smoothLive && smoothLive.time + displayCandleWidth >= leftEdge && smoothLive.time <= rightEdge) {
      visible.push(smoothLive)
    }

    // During width transition, build old visible candles for cross-fade out
    let oldVisible: CandlePoint[] = []
    if (morphT >= 0 && cwt.oldCandles.length > 0) {
      for (const c of cwt.oldCandles) {
        if (c.time + cwt.oldWidth >= leftEdge && c.time <= rightEdge) {
          oldVisible.push(c)
        }
      }
    }

    // --- Loading alpha + chart reveal ---
    const loadingTarget = cfg.loading ? 1 : 0
    loadingAlphaRef.current = lerp(loadingAlphaRef.current, loadingTarget, LOADING_ALPHA_SPEED, dt)
    if (loadingAlphaRef.current < 0.01) loadingAlphaRef.current = 0
    if (loadingAlphaRef.current > 0.99) loadingAlphaRef.current = 1
    const loadingAlpha = loadingAlphaRef.current

    const hasData = visible.length > 0
    const revealTarget = (!cfg.loading && hasData) ? 1 : 0
    chartRevealRef.current = lerp(chartRevealRef.current, revealTarget, CHART_REVEAL_SPEED, dt)
    if (Math.abs(chartRevealRef.current - revealTarget) < 0.005) chartRevealRef.current = revealTarget
    const chartReveal = chartRevealRef.current

    // Data stash for reverse morph — keep drawing chart while it morphs back
    // to the squiggly shape (identical to loading/empty line at reveal=0)
    const useStash = !hasData && chartReveal > 0.005 && lastCandlesRef.current.length > 0
    if (hasData) {
      lastCandlesRef.current = visible
      lastLiveRef.current = smoothLive ?? null
    }

    // Smoothstep for staggered reveal timing
    const revealRamp = (start: number, end: number) => {
      const t = Math.max(0, Math.min(1, (chartReveal - start) / (end - start)))
      return t * t * (3 - 2 * t)
    }

    // --- Range smoothing (matches line chart engine exactly) ---
    // No data yet — draw loading/empty state, skip chart drawing
    // Candlestick loading uses neutral grey instead of accent color
    const loadingGrey = cfg.palette.bgRgb[0] < 128 ? '#999' : '#666'

    if (!hasData && !useStash) {
      // No chart pipeline — draw loading or empty as the sole visual
      if (loadingAlpha > 0.01) {
        drawLoading(ctx, w, h, p, cfg.palette, now_ms, loadingAlpha, loadingGrey)
      }
      if ((1 - loadingAlpha) > 0.01 && !rangeInitedRef.current) {
        drawEmpty(ctx, w, h, p, cfg.palette, 1 - loadingAlpha, now_ms, false, cfg.emptyText)
      }
      // Left-edge fade
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      const fadeGrad = ctx.createLinearGradient(p.left, 0, p.left + FADE_EDGE_WIDTH, 0)
      fadeGrad.addColorStop(0, 'rgba(0, 0, 0, 1)')
      fadeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = fadeGrad
      ctx.fillRect(0, 0, p.left + FADE_EDGE_WIDTH, h)
      ctx.restore()

      rafRef.current = requestAnimationFrame(draw)
      return
    }

    const effectiveVisible = useStash ? lastCandlesRef.current : visible
    const effectiveLive = useStash ? lastLiveRef.current ?? undefined : smoothLive

    let computed = effectiveVisible.length > 0
      ? computeCandleRange(effectiveVisible)
      : { min: displayMinRef.current, max: displayMaxRef.current }
    // Blend Y range between OHLC range and close-only range during line morph
    if (lineModeProg > 0.01 && effectiveVisible.length > 0) {
      const smoothClose = lineSmoothInitedRef.current ? lineSmoothCloseRef.current : undefined
      const closeRng = computeCloseRange(effectiveVisible, smoothClose)
      computed = {
        min: computed.min + (closeRng.min - computed.min) * lineModeProg,
        max: computed.max + (closeRng.max - computed.max) * lineModeProg,
      }
    }
    // Further blend toward tick-data range during density transition
    if (lineDensityProg > 0.01 && cfg.lineData && cfg.lineData.length > 0) {
      const smoothTick = lineTickSmoothInitedRef.current ? lineTickSmoothRef.current : computed.min
      const visibleTicks: LivelinePoint[] = []
      for (const pt of cfg.lineData) {
        if (pt.time >= leftEdge && pt.time <= rightEdge) visibleTicks.push(pt)
      }
      if (visibleTicks.length > 0) {
        const tickRng = computeRange(visibleTicks, smoothTick)
        computed = {
          min: computed.min + (tickRng.min - computed.min) * lineDensityProg,
          max: computed.max + (tickRng.max - computed.max) * lineDensityProg,
        }
      }
    }
    const rangeResult = updateCandleRange(
      computed, rangeInitedRef.current,
      displayMinRef.current, displayMaxRef.current,
      isWindowTransitioning, windowTransProgress, wt,
      chartH, pausedDt,
    )
    // During width transition, override range with direct interpolation (no adaptive lerp lag)
    if (morphT >= 0) {
      rangeResult.displayMin = cwt.rangeFromMin + (cwt.rangeToMin - cwt.rangeFromMin) * morphT
      rangeResult.displayMax = cwt.rangeFromMax + (cwt.rangeToMax - cwt.rangeFromMax) * morphT
      rangeResult.minVal = rangeResult.displayMin
      rangeResult.maxVal = rangeResult.displayMax
      rangeResult.valRange = (rangeResult.displayMax - rangeResult.displayMin) || 0.001
    }
    rangeInitedRef.current = rangeResult.rangeInited
    displayMinRef.current = rangeResult.displayMin
    displayMaxRef.current = rangeResult.displayMax
    const { minVal, maxVal, valRange } = rangeResult

    const layout: ChartLayout = {
      w, h, pad: p,
      chartW, chartH,
      leftEdge, rightEdge,
      minVal, maxVal, valRange,
      toX: (t: number) => p.left + ((t - leftEdge) / (rightEdge - leftEdge)) * chartW,
      toY: (v: number) => p.top + (1 - (v - minVal) / valRange) * chartH,
    }

    // --- Hover + scrub lerp ---
    const hoverPx = hoverXRef.current
    let hoveredCandle: CandlePoint | null = null
    let isActiveHover = false

    if (hoverPx !== null && hoverPx >= p.left && hoverPx <= w - p.right) {
      hoveredCandle = candleAtX(effectiveVisible, hoverPx, displayCandleWidth, layout)
      if (hoveredCandle) {
        isActiveHover = true
        const hoverTime = layout.leftEdge + ((hoverPx - p.left) / chartW) * (layout.rightEdge - layout.leftEdge)
        lastHoverRef.current = { x: hoverPx, time: hoverTime, candle: hoveredCandle }
      }
    }

    // Scrub amount: smooth 0↔1
    const scrubTarget = isActiveHover ? 1 : 0
    scrubAmountRef.current = lerp(scrubAmountRef.current, scrubTarget, SCRUB_LERP_SPEED, dt)
    if (scrubAmountRef.current < 0.01) scrubAmountRef.current = 0
    if (scrubAmountRef.current > 0.99) scrubAmountRef.current = 1
    const scrubAmount = scrubAmountRef.current

    // Use last known hover during fade-out
    let drawHoverX = hoverPx
    let drawHoverTime = 0
    let drawHoverCandle: CandlePoint | null = hoveredCandle
    if (!isActiveHover && scrubAmount > 0 && lastHoverRef.current) {
      drawHoverX = lastHoverRef.current.x
      drawHoverTime = lastHoverRef.current.time
      drawHoverCandle = lastHoverRef.current.candle
    } else if (isActiveHover && lastHoverRef.current) {
      drawHoverTime = lastHoverRef.current.time
    }

    // ======================
    // DRAW — staggered reveal (matches line chart patterns)
    // ======================

    // Loading line: fades out over first 50% of reveal (overlaps with candle morph)
    const loadingFade = 1 - revealRamp(0, 0.5)
    if (loadingAlpha > 0.01 && loadingFade > 0.01) {
      drawLoading(ctx, w, h, p, cfg.palette, now_ms, loadingAlpha * loadingFade, loadingGrey)
    }

    // Grid: fades in (25%–60%)
    const gridAlpha = revealRamp(0.25, 0.6)
    if (cfg.grid && gridAlpha > 0.01) {
      ctx.save()
      if (gridAlpha < 1) ctx.globalAlpha = gridAlpha
      drawGrid(ctx, layout, cfg.palette, cfg.formatValue, gridStateRef.current, pausedDt)
      ctx.restore()
    }

    // --- Loading morph: candles grow from squiggly positions ---
    // Matches line chart pattern: at reveal=0, OHLC = squiggly Y; at reveal=1, OHLC = real
    const morphCenterY = p.top + chartH / 2
    const morphAmplitude = chartH * LOADING_AMPLITUDE_RATIO
    const morphScroll = now_ms * LOADING_SCROLL_SPEED
    const fromYpx = (py: number) => minVal + (1 - (py - p.top) / chartH) * valRange

    let drawCandles = effectiveVisible
    let drawOldCandles = oldVisible
    let drawLive = effectiveLive
    if (chartReveal < 1) {
      const morphOHLC = (c: CandlePoint, cw: number): CandlePoint => {
        const cx = layout.toX(c.time + cw / 2)
        const t = Math.max(0, Math.min(1, (cx - p.left) / chartW))
        const baseVal = fromYpx(loadingY(t, morphCenterY, morphAmplitude, morphScroll))
        const r = chartReveal
        return {
          time: c.time,
          open: baseVal + (c.open - baseVal) * r,
          high: baseVal + (c.high - baseVal) * r,
          low: baseVal + (c.low - baseVal) * r,
          close: baseVal + (c.close - baseVal) * r,
        }
      }
      drawCandles = effectiveVisible.map(c => morphOHLC(c, displayCandleWidth))
      if (oldVisible.length > 0) {
        drawOldCandles = oldVisible.map(c => morphOHLC(c, cwt.oldWidth))
      }
      if (effectiveLive) {
        drawLive = morphOHLC(effectiveLive, displayCandleWidth)
      }
    }

    // Line mode: blend live close toward smooth value that spans candle transitions.
    // This prevents the line tip from jumping when a new candle period starts.
    if (lineModeProg > 0.01 && drawLive && lineSmoothInitedRef.current) {
      const blended = drawLive.close + (lineSmoothCloseRef.current - drawLive.close) * lineModeProg
      drawLive = { ...drawLive, close: blended }
      // Sync the live candle entry in drawCandles so the spline is consistent
      const li = drawCandles.length - 1
      if (li >= 0 && drawCandles[li].time === drawLive.time) {
        drawCandles = drawCandles.slice()
        drawCandles[li] = { ...drawCandles[li], close: blended }
      }
    }

    // Line mode OHLC collapse: candle bodies shrink toward close
    if (lineModeProg > 0.01 && lineModeProg < 0.99) {
      const collapseOHLC = (c: CandlePoint): CandlePoint => {
        const inv = 1 - lineModeProg
        return {
          time: c.time,
          open:  c.close + (c.open  - c.close) * inv,
          high:  c.close + (c.high  - c.close) * inv,
          low:   c.close + (c.low   - c.close) * inv,
          close: c.close,
        }
      }
      drawCandles = drawCandles.map(collapseOHLC)
      if (drawOldCandles.length > 0) drawOldCandles = drawOldCandles.map(collapseOHLC)
      if (drawLive) drawLive = collapseOHLC(drawLive)
    }

    // Spline + fill overlay: fades in with lineModeProg
    // Tip extends spline to current time (like line chart's live edge)
    const liveTipX = drawLive ? layout.toX(now) : undefined
    const liveTipY = drawLive ? layout.toY(drawLive.close) : undefined

    // Build visible tick points for density transition.
    // Each tick's Y is blended between its candle-close-interpolated position
    // (where the sparse candle-close spline passes) and its real tick value.
    // At dp=0 the spline matches the candle-close shape; at dp=1 it shows full tick detail.
    // This produces a single morphing spline — no cross-fade.
    let visibleTickPts: [number, number][] | undefined
    let tickTipY: number | undefined
    if (lineDensityProg > 0.01 && cfg.lineData && cfg.lineData.length > 0) {
      const yMin = p.top
      const yMax = h - p.bottom
      const clampTickY = (y: number) => Math.max(yMin, Math.min(yMax, y))

      // Build candle-close reference points for interpolation (sorted by time)
      const closeRefs: { t: number; v: number }[] = []
      for (const c of drawCandles) {
        closeRefs.push({ t: c.time + displayCandleWidth / 2, v: c.close })
      }
      if (drawLive) {
        closeRefs.push({ t: now, v: drawLive.close })
      }

      visibleTickPts = []
      let refIdx = 0
      for (const pt of cfg.lineData) {
        if (pt.time < leftEdge || pt.time > rightEdge) continue

        // Find bracketing candle-close reference points
        while (refIdx < closeRefs.length - 2 && closeRefs[refIdx + 1].t < pt.time) refIdx++

        let interpClose: number
        if (closeRefs.length === 0) {
          interpClose = pt.value
        } else if (closeRefs.length === 1 || pt.time <= closeRefs[0].t) {
          interpClose = closeRefs[0].v
        } else if (refIdx >= closeRefs.length - 1) {
          interpClose = closeRefs[closeRefs.length - 1].v
        } else {
          const a = closeRefs[refIdx]
          const b = closeRefs[refIdx + 1]
          const span = b.t - a.t
          const frac = span > 0 ? Math.max(0, Math.min(1, (pt.time - a.t) / span)) : 0
          interpClose = a.v + (b.v - a.v) * frac
        }

        // Blend: at dp=0 use candle-close interpolation, at dp=1 use real tick value
        const blended = interpClose + (pt.value - interpClose) * lineDensityProg
        visibleTickPts.push([layout.toX(pt.time), clampTickY(layout.toY(blended))])
      }

      // Tick tip for dot blending (unblended — dot applies its own dp blend)
      const smoothTick = lineTickSmoothInitedRef.current
        ? lineTickSmoothRef.current
        : (cfg.lineValue ?? cfg.lineData[cfg.lineData.length - 1].value)
      tickTipY = clampTickY(layout.toY(smoothTick))

      // Spline tip: blended between candle close and tick smooth
      if (liveTipX !== undefined && drawLive) {
        const tipBlended = drawLive.close + (smoothTick - drawLive.close) * lineDensityProg
        visibleTickPts.push([liveTipX, clampTickY(layout.toY(tipBlended))])
      }
    }

    if (lineModeProg > 0.01) {
      ctx.save()
      ctx.globalAlpha = chartReveal
      drawLineOverlay(ctx, layout, cfg.palette, drawCandles, displayCandleWidth, lineModeProg, drawHoverX ?? 0, scrubAmount, liveTipX, liveTipY, visibleTickPts, lineDensityProg)
      ctx.restore()
    }

    // Close price line: fades in (40%–80%), uses morphed live candle position
    const closeAlpha = revealRamp(0.4, 0.8)
    if (drawLive && closeAlpha > 0.01) {
      // Candle-colored close line (fades out with lineModeProg)
      if (lineModeProg < 0.99) {
        ctx.save()
        ctx.globalAlpha = closeAlpha * (1 - lineModeProg)
        drawClosePrice(ctx, layout, cfg.palette, drawLive, scrubAmount, liveBullRef.current)
        ctx.restore()
      }
      // Accent-colored dash line (fades in with lineModeProg)
      if (lineModeProg > 0.01) {
        const dashY = layout.toY(drawLive.close)
        if (dashY >= p.top && dashY <= h - p.bottom) {
          ctx.save()
          ctx.setLineDash([4, 4])
          ctx.strokeStyle = cfg.palette.dashLine
          ctx.lineWidth = 1
          ctx.globalAlpha = closeAlpha * lineModeProg * (1 - scrubAmount * 0.2)
          ctx.beginPath()
          ctx.moveTo(p.left, dashY)
          ctx.lineTo(w - p.right, dashY)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.restore()
        }
      }
    }

    // Candles: alpha = chartReveal * (1 - lineModeProg)
    const candleAlpha = chartReveal * (1 - lineModeProg)
    if (candleAlpha > 0.01) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(p.left - 1, p.top, chartW + 2, chartH)
      ctx.clip()
      const accentCol = lineModeProg > 0.01 ? cfg.palette.line : undefined
      if (morphT >= 0 && drawOldCandles.length > 0) {
        // Cross-fade: old candles fade out at their width, new fade in at target width
        ctx.globalAlpha = (1 - morphT) * candleAlpha
        drawCandlesticks(
          ctx, layout, drawOldCandles, cwt.oldWidth,
          -1, now_ms, drawHoverX ?? 0, scrubAmount,
          1, -1, accentCol, lineModeProg,
        )
        ctx.globalAlpha = morphT * candleAlpha
        drawCandlesticks(
          ctx, layout, drawCandles, cfg.candleWidth,
          effectiveLive?.time ?? -1, now_ms,
          drawHoverX ?? 0, scrubAmount,
          liveBirthAlphaRef.current, liveBullRef.current,
          accentCol, lineModeProg,
        )
        ctx.globalAlpha = 1
      } else {
        if (candleAlpha < 1) ctx.globalAlpha = candleAlpha
        drawCandlesticks(
          ctx, layout, drawCandles, displayCandleWidth,
          effectiveLive?.time ?? -1, now_ms,
          drawHoverX ?? 0, scrubAmount,
          liveBirthAlphaRef.current, liveBullRef.current,
          accentCol, lineModeProg,
        )
      }
      ctx.restore()
    }

    // Live dot: appears in second half of line morph, positioned at live tip (now)
    if (lineModeProg > 0.5 && drawLive && chartReveal > 0.5) {
      const dotAlpha = (lineModeProg - 0.5) * 2
      const dotX = layout.toX(now)
      let dotY = layout.toY(drawLive.close)
      // Blend dot Y toward tick smooth value during density transition
      if (lineDensityProg > 0.01 && tickTipY !== undefined) {
        dotY = dotY + (tickTipY - dotY) * lineDensityProg
      }
      ctx.save()
      ctx.globalAlpha = dotAlpha * chartReveal
      drawDot(ctx, dotX, dotY, cfg.palette, lineModeProg > 0.8, scrubAmount, now_ms)
      ctx.restore()
    }

    // Time axis: fades in (25%–60%)
    const timeAlpha = revealRamp(0.25, 0.6)
    if (timeAlpha > 0.01) {
      ctx.save()
      if (timeAlpha < 1) ctx.globalAlpha = timeAlpha
      drawTimeAxis(ctx, layout, cfg.palette, effectiveWindow, cfg.windowSecs, cfg.formatTime, timeAxisStateRef.current, pausedDt)
      ctx.restore()
    }

    // Left edge fade
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    const fadeGrad = ctx.createLinearGradient(p.left, 0, p.left + FADE_EDGE_WIDTH, 0)
    fadeGrad.addColorStop(0, 'rgba(0, 0, 0, 1)')
    fadeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = fadeGrad
    ctx.fillRect(0, 0, p.left + FADE_EDGE_WIDTH, h)
    ctx.restore()

    // During reverse morph (chart → empty), overlay gradient gap + text
    // on top of the morphing candles. skipLine=true avoids double-drawing the squiggly.
    const bgAlpha = 1 - chartReveal
    if (bgAlpha > 0.01 && revealTarget === 0 && !cfg.loading) {
      const bgEmptyAlpha = (1 - loadingAlpha) * bgAlpha
      if (bgEmptyAlpha > 0.01) {
        drawEmpty(ctx, w, h, p, cfg.palette, bgEmptyAlpha, now_ms, true, cfg.emptyText)
      }
    }

    // Crosshair: only when mostly revealed (70%+)
    if (chartReveal > 0.7 && drawHoverCandle && drawHoverX !== null && scrubAmount > 0.01) {
      if (lineModeProg > 0.5) {
        drawLineModeCrosshair(
          ctx, layout, cfg.palette,
          drawHoverX, drawHoverCandle.close, drawHoverTime,
          cfg.formatValue, cfg.formatTime,
          scrubAmount,
        )
      } else {
        drawCandleCrosshair(
          ctx, layout, cfg.palette,
          drawHoverX, drawHoverCandle, drawHoverTime,
          cfg.formatValue, cfg.formatTime,
          scrubAmount,
        )
      }
    }

    rafRef.current = requestAnimationFrame(draw)
  }, [])

  // Start/stop loop
  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])

  // Visibility listener
  useEffect(() => {
    const onVis = () => { if (!document.hidden && !rafRef.current) rafRef.current = requestAnimationFrame(draw) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [draw])

  const cursorStyle = scrub ? cursor : 'default'

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height: '100%', position: 'relative', ...style }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', cursor: cursorStyle }} />
    </div>
  )
}
