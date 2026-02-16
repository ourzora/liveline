import type { Momentum, LivelinePoint } from '../types'

/**
 * Auto-detect momentum from recent data points.
 * Only triggers during active movement — checks the last few points,
 * not the total delta over the full lookback window.
 */
export function detectMomentum(points: LivelinePoint[], lookback = 20): Momentum {
  if (points.length < 5) return 'flat'

  const recent = points.slice(-lookback)

  // Range of the full lookback for threshold calculation
  let min = Infinity
  let max = -Infinity
  for (const p of recent) {
    if (p.value < min) min = p.value
    if (p.value > max) max = p.value
  }
  const range = max - min
  if (range === 0) return 'flat'

  // Only look at the last 5 points for active velocity
  const tail = recent.slice(-5)
  const first = tail[0].value
  const last = tail[tail.length - 1].value
  const delta = last - first

  const threshold = range * 0.12

  if (delta > threshold) return 'up'
  if (delta < -threshold) return 'down'
  return 'flat'
}
