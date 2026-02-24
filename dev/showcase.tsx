import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { Liveline } from 'liveline'
import type { LivelinePoint, CandlePoint } from 'liveline'

// --- Data ---

function generateTick(prev: number, time: number, base: number): LivelinePoint {
  const scale = base / 100 * 0.4
  const spike = Math.random() < 0.06 ? (Math.random() - 0.5) * scale * 3 : 0
  const delta = (Math.random() - 0.49) * scale + spike
  return { time, value: prev + delta }
}

function aggregateCandles(ticks: LivelinePoint[], width: number): { candles: CandlePoint[]; live: CandlePoint | null } {
  if (ticks.length === 0) return { candles: [], live: null }
  const candles: CandlePoint[] = []
  let slot = Math.floor(ticks[0].time / width) * width
  let o = ticks[0].value, h = o, l = o, c = o
  for (let i = 1; i < ticks.length; i++) {
    const t = ticks[i]
    if (t.time >= slot + width) {
      candles.push({ time: slot, open: o, high: h, low: l, close: c })
      slot = Math.floor(t.time / width) * width
      o = t.value; h = o; l = o; c = o
    } else {
      c = t.value
      if (c > h) h = c
      if (c < l) l = c
    }
  }
  return { candles, live: { time: slot, open: o, high: h, low: l, close: c } }
}

const WINDOWS = [
  { label: '10s', secs: 10 },
  { label: '30s', secs: 30 },
  { label: '1m', secs: 60 },
  { label: '5m', secs: 300 },
]

const BASE = 65000
const CANDLE_WIDTH = 2
const TICK_MS = 200
const MAX_TICKS = 2000

const formatValue = (v: number) =>
  '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type State = 'live' | 'paused'

// --- Showcase ---

function Showcase() {
  const [data, setData] = useState<LivelinePoint[]>([])
  const [value, setValue] = useState(BASE)
  const [candles, setCandles] = useState<CandlePoint[]>([])
  const [liveCandle, setLiveCandle] = useState<CandlePoint | null>(null)
  const [chartType, setChartType] = useState<'line' | 'candle'>('candle')
  const [state, setState] = useState<State>('live')
  const [windowSecs, setWindowSecs] = useState(30)

  const lastValueRef = useRef(BASE)
  const liveCandleRef = useRef<CandlePoint | null>(null)
  const dataRef = useRef<LivelinePoint[]>([])
  const intervalRef = useRef<number>(0)

  const tickAndAggregate = useCallback((pt: LivelinePoint) => {
    const lc = liveCandleRef.current
    if (!lc) {
      const slot = Math.floor(pt.time / CANDLE_WIDTH) * CANDLE_WIDTH
      liveCandleRef.current = { time: slot, open: pt.value, high: pt.value, low: pt.value, close: pt.value }
      setLiveCandle({ ...liveCandleRef.current })
    } else if (pt.time >= lc.time + CANDLE_WIDTH) {
      const committed = { ...lc }
      setCandles(prev => {
        const next = [...prev, committed]
        return next.length > MAX_TICKS ? next.slice(-MAX_TICKS) : next
      })
      const slot = Math.floor(pt.time / CANDLE_WIDTH) * CANDLE_WIDTH
      liveCandleRef.current = { time: slot, open: pt.value, high: pt.value, low: pt.value, close: pt.value }
      setLiveCandle({ ...liveCandleRef.current })
    } else {
      lc.close = pt.value
      if (pt.value > lc.high) lc.high = pt.value
      if (pt.value < lc.low) lc.low = pt.value
      setLiveCandle({ ...lc })
    }
  }, [])

  const startLive = useCallback(() => {
    clearInterval(intervalRef.current)

    const now = Date.now() / 1000
    const seed: LivelinePoint[] = []
    let v = BASE
    // Seed ~1600 ticks at 0.2s spacing = 320s of history (covers 5m window)
    for (let i = 1600; i >= 0; i--) {
      const pt = generateTick(v, now - i * 0.2, BASE)
      seed.push(pt)
      v = pt.value
    }
    setData(seed)
    dataRef.current = seed
    setValue(v)
    lastValueRef.current = v

    const agg = aggregateCandles(seed, CANDLE_WIDTH)
    setCandles(agg.candles)
    setLiveCandle(agg.live)
    liveCandleRef.current = agg.live ? { ...agg.live } : null

    intervalRef.current = window.setInterval(() => {
      const now = Date.now() / 1000
      const pt = generateTick(lastValueRef.current, now, BASE)
      lastValueRef.current = pt.value
      setValue(pt.value)
      setData(prev => {
        const next = [...prev, pt]
        const trimmed = next.length > MAX_TICKS ? next.slice(-MAX_TICKS) : next
        dataRef.current = trimmed
        return trimmed
      })
      tickAndAggregate(pt)
    }, TICK_MS)
  }, [tickAndAggregate])

  useEffect(() => {
    if (dataRef.current.length === 0) startLive()
    if (state === 'paused') clearInterval(intervalRef.current)
    return () => clearInterval(intervalRef.current)
  }, [state, startLive])

  const isPaused = state === 'paused'

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 720,
        height: 360,
      }}>
        <Liveline
          mode="candle"
          data={data}
          value={value}
          candles={candles}
          candleWidth={CANDLE_WIDTH}
          liveCandle={liveCandle ?? undefined}
          lineMode={chartType === 'line'}
          lineData={data}
          lineValue={value}
          theme="light"
          color="#f7931a"
          window={windowSecs}
          windows={WINDOWS}
          onWindowChange={setWindowSecs}
          onModeChange={setChartType}
          formatValue={formatValue}
          scrub
          grid
        />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Showcase />)
