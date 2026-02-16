/**
 * Draw Catmull-Rom spline through points using bezier curves.
 * Continues from current ctx position — caller must moveTo first point.
 */
export function drawSpline(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  tension = 0.15,
  maxPoints = 300,
) {
  if (pts.length < 2) return
  if (pts.length === 2) {
    ctx.lineTo(pts[1][0], pts[1][1])
    return
  }

  // Downsample if needed
  let sampled = pts
  if (pts.length > maxPoints) {
    const step = pts.length / maxPoints
    sampled = []
    for (let i = 0; i < maxPoints; i++) {
      sampled.push(pts[Math.round(i * step)])
    }
    sampled.push(pts[pts.length - 1])
  }

  for (let i = 0; i < sampled.length - 1; i++) {
    const p0 = sampled[Math.max(0, i - 1)]
    const p1 = sampled[i]
    const p2 = sampled[i + 1]
    const p3 = sampled[Math.min(sampled.length - 1, i + 2)]
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) * tension,
      p1[1] + (p2[1] - p0[1]) * tension,
      p2[0] - (p3[0] - p1[0]) * tension,
      p2[1] - (p3[1] - p1[1]) * tension,
      p2[0],
      p2[1],
    )
  }
}
