// src/Liveline.tsx
import { useRef as useRef2, useState, useLayoutEffect, useMemo } from "react";

// src/theme.ts
function parseColorRgb(color) {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return [128, 128, 128];
}
function rgba(r, g, b, a) {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
function resolveTheme(color, mode) {
  const [r, g, b] = parseColorRgb(color);
  const isDark = mode === "dark";
  return {
    // Line
    line: color,
    lineWidth: 2,
    // Fill gradient
    fillTop: rgba(r, g, b, isDark ? 0.12 : 0.08),
    fillBottom: rgba(r, g, b, 0),
    // Grid
    gridLine: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)",
    gridLabel: isDark ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.35)",
    // Dot — always semantic
    dotUp: "#22c55e",
    dotDown: "#ef4444",
    dotFlat: color,
    glowUp: "rgba(34, 197, 94, 0.18)",
    glowDown: "rgba(239, 68, 68, 0.18)",
    glowFlat: rgba(r, g, b, 0.12),
    // Badge
    badgeOuterBg: isDark ? "rgba(40, 40, 40, 0.95)" : "rgba(255, 255, 255, 0.95)",
    badgeOuterShadow: isDark ? "rgba(0, 0, 0, 0.4)" : "rgba(0, 0, 0, 0.15)",
    badgeBg: color,
    badgeText: "#ffffff",
    // Dash line
    dashLine: rgba(r, g, b, 0.4),
    // Reference line
    refLine: isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.12)",
    refLabel: isDark ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.4)",
    // Time axis
    timeLabel: isDark ? "rgba(255, 255, 255, 0.35)" : "rgba(0, 0, 0, 0.3)",
    // Crosshair
    crosshairLine: isDark ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.12)",
    tooltipBg: isDark ? "rgba(30, 30, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
    tooltipText: isDark ? "#e5e5e5" : "#1a1a1a",
    tooltipBorder: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)",
    // Background
    bgRgb: isDark ? [10, 10, 10] : [255, 255, 255],
    // Fonts
    labelFont: '11px "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
    valueFont: '600 11px "SF Mono", Menlo, monospace',
    badgeFont: '500 11px "SF Mono", Menlo, monospace'
  };
}

// src/useLivelineEngine.ts
import { useRef, useEffect, useCallback } from "react";

// src/math/lerp.ts
function lerp(current, target, speed, dt = 16.67) {
  const factor = 1 - Math.pow(1 - speed, dt / 16.67);
  return current + (target - current) * factor;
}

// src/math/range.ts
function computeRange(visible, currentValue, referenceValue, exaggerate) {
  let targetMin = Infinity;
  let targetMax = -Infinity;
  for (const p of visible) {
    if (p.value < targetMin) targetMin = p.value;
    if (p.value > targetMax) targetMax = p.value;
  }
  if (currentValue < targetMin) targetMin = currentValue;
  if (currentValue > targetMax) targetMax = currentValue;
  if (referenceValue !== void 0) {
    if (referenceValue < targetMin) targetMin = referenceValue;
    if (referenceValue > targetMax) targetMax = referenceValue;
  }
  const rawRange = targetMax - targetMin;
  const marginFactor = exaggerate ? 0.01 : 0.12;
  const minRange = rawRange * (exaggerate ? 0.02 : 0.1) || (exaggerate ? 0.04 : 0.4);
  if (rawRange < minRange) {
    const mid = (targetMin + targetMax) / 2;
    targetMin = mid - minRange / 2;
    targetMax = mid + minRange / 2;
  } else {
    const margin = rawRange * marginFactor;
    targetMin -= margin;
    targetMax += margin;
  }
  return { min: targetMin, max: targetMax };
}

// src/math/momentum.ts
function detectMomentum(points, lookback = 20) {
  if (points.length < 5) return "flat";
  const start = Math.max(0, points.length - lookback);
  let min = Infinity;
  let max = -Infinity;
  for (let i = start; i < points.length; i++) {
    const v = points[i].value;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range === 0) return "flat";
  const tailStart = Math.max(start, points.length - 5);
  const first = points[tailStart].value;
  const last = points[points.length - 1].value;
  const delta = last - first;
  const threshold = range * 0.12;
  if (delta > threshold) return "up";
  if (delta < -threshold) return "down";
  return "flat";
}

// src/math/interpolate.ts
function interpolateAtTime(points, time) {
  if (points.length === 0) return null;
  if (time <= points[0].time) return points[0].value;
  if (time >= points[points.length - 1].time) return points[points.length - 1].value;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = lo + hi >> 1;
    if (points[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const p1 = points[lo];
  const p2 = points[hi];
  const dt = p2.time - p1.time;
  if (dt === 0) return p1.value;
  const t = (time - p1.time) / dt;
  return p1.value + (p2.value - p1.value) * t;
}

// src/canvas/dpr.ts
function getDpr() {
  if (typeof window === "undefined") return 1;
  return Math.min(window.devicePixelRatio || 1, 3);
}
function applyDpr(ctx, dpr, w, h) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
}

// src/draw/grid.ts
function pickInterval(valRange, pxPerUnit, minGap, prev) {
  if (prev > 0) {
    const px = prev * pxPerUnit;
    if (px >= minGap * 0.5 && px <= minGap * 4) return prev;
  }
  const divisorSets = [[2, 2.5, 2], [2, 2, 2.5], [2.5, 2, 2]];
  let best = Infinity;
  for (const divs of divisorSets) {
    let span = Math.pow(10, Math.ceil(Math.log10(valRange)));
    let i = 0;
    while (span / divs[i % 3] * pxPerUnit >= minGap) {
      span /= divs[i % 3];
      i++;
    }
    if (span < best) best = span;
  }
  return best === Infinity ? valRange / 5 : best;
}
function divisible(val, interval) {
  const ratio = val / interval;
  return Math.abs(ratio - Math.round(ratio)) < 0.01;
}
var FADE_IN = 0.18;
var FADE_OUT = 0.12;
function drawGrid(ctx, layout, palette, formatValue, state, dt) {
  const { w, h, pad, valRange, minVal, maxVal, toY } = layout;
  const chartH = h - pad.top - pad.bottom;
  if (chartH <= 0 || valRange <= 0) return;
  const pxPerUnit = chartH / valRange;
  const coarse = pickInterval(valRange, pxPerUnit, 36, state.interval);
  state.interval = coarse;
  const fine = coarse / 2;
  const finePx = fine * pxPerUnit;
  const fineTarget = finePx < 40 ? 0 : finePx >= 60 ? 1 : (finePx - 40) / 20;
  const fadeZone = 32;
  const edgeAlpha = (y) => {
    const fromEdge = Math.min(y - pad.top, h - pad.bottom - y);
    if (fromEdge >= fadeZone) return 1;
    if (fromEdge <= 0) return 0;
    return fromEdge / fadeZone;
  };
  const targets = /* @__PURE__ */ new Map();
  const first = Math.ceil(minVal / fine) * fine;
  for (let val = first; val <= maxVal; val += fine) {
    const y = toY(val);
    if (y < pad.top - 2 || y > h - pad.bottom + 2) continue;
    const isCoarse = divisible(val, coarse);
    const target = (isCoarse ? 1 : fineTarget) * edgeAlpha(y);
    const key = Math.round(val * 1e3);
    targets.set(key, target);
  }
  for (const [key, alpha] of state.labels) {
    const target = targets.get(key) ?? 0;
    const speed = target >= alpha ? FADE_IN : FADE_OUT;
    let next = lerp(alpha, target, speed, dt);
    if (Math.abs(next - target) < 0.02) next = target;
    if (next < 0.01 && target === 0) {
      state.labels.delete(key);
    } else {
      state.labels.set(key, next);
    }
  }
  for (const [key, target] of targets) {
    if (!state.labels.has(key)) {
      state.labels.set(key, target * FADE_IN);
    }
  }
  const baseAlpha = ctx.globalAlpha;
  ctx.setLineDash([1, 3]);
  ctx.lineWidth = 1;
  ctx.font = palette.labelFont;
  ctx.textAlign = "left";
  for (const [key, alpha] of state.labels) {
    if (alpha < 0.02) continue;
    const val = key / 1e3;
    const y = toY(val);
    if (y < pad.top - 10 || y > h - pad.bottom + 10) continue;
    ctx.save();
    ctx.globalAlpha = baseAlpha * alpha;
    ctx.strokeStyle = palette.gridLine;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = palette.gridLabel;
    ctx.fillText(formatValue(val), w - pad.right + 8, y + 4);
    ctx.restore();
  }
  ctx.setLineDash([]);
}

// src/math/spline.ts
function drawSpline(ctx, pts) {
  if (pts.length < 2) return;
  if (pts.length === 2) {
    ctx.lineTo(pts[1][0], pts[1][1]);
    return;
  }
  const n = pts.length;
  const delta = new Array(n - 1);
  const h = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = pts[i + 1][0] - pts[i][0];
    delta[i] = h[i] === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / h[i];
  }
  const m = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (delta[i - 1] + delta[i]) / 2;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / delta[i];
      const beta = m[i + 1] / delta[i];
      const s2 = alpha * alpha + beta * beta;
      if (s2 > 9) {
        const s = 3 / Math.sqrt(s2);
        m[i] = s * alpha * delta[i];
        m[i + 1] = s * beta * delta[i];
      }
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const hi = h[i];
    ctx.bezierCurveTo(
      pts[i][0] + hi / 3,
      pts[i][1] + m[i] * hi / 3,
      pts[i + 1][0] - hi / 3,
      pts[i + 1][1] - m[i + 1] * hi / 3,
      pts[i + 1][0],
      pts[i + 1][1]
    );
  }
}

// src/draw/loadingShape.ts
var LOADING_AMPLITUDE_RATIO = 0.07;
var LOADING_SCROLL_SPEED = 1e-3;
function loadingY(t, centerY, amplitude, scroll) {
  return centerY + amplitude * (Math.sin(t * 9.4 + scroll) * 0.55 + Math.sin(t * 15.7 + scroll * 1.3) * 0.3 + Math.sin(t * 4.2 + scroll * 0.7) * 0.15);
}
function loadingBreath(now_ms) {
  return 0.22 + 0.08 * Math.sin(now_ms / 1200 * Math.PI);
}

// src/draw/line.ts
function parseRgba(color) {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const rgba2 = color.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)/);
  if (rgba2) return [+rgba2[1], +rgba2[2], +rgba2[3], +rgba2[4]];
  const rgb = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], 1];
  return [128, 128, 128, 1];
}
function blendColor(c1, c2, t) {
  if (t <= 0) return c1;
  if (t >= 1) return c2;
  const [r1, g1, b1, a1] = parseRgba(c1);
  const [r2, g2, b2, a2] = parseRgba(c2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  const a = a1 + (a2 - a1) * t;
  if (a >= 0.995) return `rgb(${r},${g},${b})`;
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}
function renderCurve(ctx, layout, palette, pts, showFill, lineAlpha = 1, fillAlpha = 1, strokeColor) {
  const { h, pad } = layout;
  const baseAlpha = ctx.globalAlpha;
  if (showFill && fillAlpha > 0.01) {
    ctx.globalAlpha = baseAlpha * fillAlpha;
    const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
    grad.addColorStop(0, palette.fillTop);
    grad.addColorStop(1, palette.fillBottom);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], h - pad.bottom);
    ctx.lineTo(pts[0][0], pts[0][1]);
    drawSpline(ctx, pts);
    ctx.lineTo(pts[pts.length - 1][0], h - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.globalAlpha = baseAlpha * lineAlpha;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  drawSpline(ctx, pts);
  ctx.strokeStyle = strokeColor ?? palette.line;
  ctx.lineWidth = palette.lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.globalAlpha = baseAlpha;
}
function drawLine(ctx, layout, palette, visible, smoothValue, now, showFill, scrubX, scrubAmount = 0, chartReveal = 1, now_ms = 0, colorBlend = 1, skipDashLine = false, fillScale = 1) {
  const { h, pad, toX, toY, chartW, chartH } = layout;
  const incomingAlpha = ctx.globalAlpha;
  const yMin = pad.top;
  const yMax = h - pad.bottom;
  const clampY = (y) => Math.max(yMin, Math.min(yMax, y));
  const centerY = pad.top + chartH / 2;
  const amplitude = chartH * LOADING_AMPLITUDE_RATIO;
  const scroll = now_ms * LOADING_SCROLL_SPEED;
  const morphY = chartReveal < 1 ? (rawY, x) => {
    const t = Math.max(0, Math.min(1, (x - pad.left) / chartW));
    const centerDist = Math.abs(t - 0.5) * 2;
    const localReveal = Math.max(0, Math.min(1, (chartReveal - centerDist * 0.4) / 0.6));
    const baseY = loadingY(t, centerY, amplitude, scroll);
    return baseY + (rawY - baseY) * localReveal;
  } : (rawY, _x) => rawY;
  const pts = visible.map((p, i) => {
    const x = toX(p.time);
    const y = i === visible.length - 1 ? morphY(clampY(toY(smoothValue)), x) : morphY(clampY(toY(p.value)), x);
    return [x, y];
  });
  const liveTipX = toX(now);
  const fullRightX = pad.left + chartW;
  const tipX = chartReveal < 1 ? liveTipX + (fullRightX - liveTipX) * (1 - chartReveal) : liveTipX;
  pts.push([tipX, morphY(clampY(toY(smoothValue)), tipX)]);
  if (pts.length < 2) return;
  let lineAlpha = 1;
  let fillAlpha = fillScale;
  if (chartReveal < 1) {
    const breath = loadingBreath(now_ms);
    lineAlpha = breath + (1 - breath) * chartReveal;
    fillAlpha = chartReveal * fillScale;
  }
  const colorT = Math.min(1, chartReveal * 3) * colorBlend;
  const strokeColor = chartReveal < 1 || colorBlend < 1 ? blendColor(palette.gridLabel, palette.line, colorT) : void 0;
  const isScrubbing = scrubX !== null;
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left - 1, pad.top, chartW + 2, chartH);
  ctx.clip();
  if (isScrubbing) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, scrubX, h);
    ctx.clip();
    renderCurve(ctx, layout, palette, pts, showFill, lineAlpha, fillAlpha, strokeColor);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(scrubX, 0, layout.w - scrubX, h);
    ctx.clip();
    ctx.globalAlpha = incomingAlpha * (1 - scrubAmount * 0.6);
    renderCurve(ctx, layout, palette, pts, showFill, lineAlpha, fillAlpha, strokeColor);
    ctx.restore();
  } else {
    renderCurve(ctx, layout, palette, pts, showFill, lineAlpha, fillAlpha, strokeColor);
  }
  ctx.restore();
  if (!skipDashLine) {
    const realCurrentY = Math.max(pad.top, Math.min(h - pad.bottom, toY(smoothValue)));
    const currentY = chartReveal < 1 ? centerY + (realCurrentY - centerY) * chartReveal : realCurrentY;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = palette.dashLine;
    ctx.lineWidth = 1;
    const dashBase = isScrubbing ? 1 - scrubAmount * 0.2 : 1;
    ctx.globalAlpha = incomingAlpha * (chartReveal < 1 ? dashBase * chartReveal : dashBase);
    ctx.beginPath();
    ctx.moveTo(pad.left, currentY);
    ctx.lineTo(layout.w - pad.right, currentY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = incomingAlpha;
  const last = pts[pts.length - 1];
  last[1] = Math.max(10, Math.min(h - 10, last[1]));
  return pts;
}

// src/draw/dot.ts
var PULSE_INTERVAL = 1500;
var PULSE_DURATION = 900;
function lerpColor(a, b, t) {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
function drawDot(ctx, x, y, palette, pulse = true, scrubAmount = 0, now_ms = performance.now()) {
  const baseAlpha = ctx.globalAlpha;
  const dim = scrubAmount * 0.7;
  if (pulse && dim < 0.3) {
    const t = now_ms % PULSE_INTERVAL / PULSE_DURATION;
    if (t < 1) {
      const radius = 9 + t * 12;
      const pulseAlpha = 0.35 * (1 - t) * (1 - dim * 3);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = baseAlpha * pulseAlpha;
      ctx.stroke();
    }
  }
  const outerRgb = parseColorRgb(palette.badgeOuterBg);
  ctx.save();
  ctx.globalAlpha = baseAlpha;
  ctx.shadowColor = palette.badgeOuterShadow;
  ctx.shadowBlur = 6 * (1 - dim);
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.arc(x, y, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = palette.badgeOuterBg;
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = baseAlpha;
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  if (dim > 0.01) {
    const lineRgb = parseColorRgb(palette.line);
    ctx.fillStyle = lerpColor(lineRgb, outerRgb, dim);
  } else {
    ctx.fillStyle = palette.line;
  }
  ctx.fill();
}
function drawArrows(ctx, x, y, momentum, palette, arrows, dt, now_ms = performance.now()) {
  const baseAlpha = ctx.globalAlpha;
  const upTarget = momentum === "up" ? 1 : 0;
  const downTarget = momentum === "down" ? 1 : 0;
  const canFadeInUp = arrows.down < 0.02;
  const canFadeInDown = arrows.up < 0.02;
  arrows.up = lerp(arrows.up, canFadeInUp ? upTarget : 0, upTarget > arrows.up ? 0.08 : 0.04, dt);
  arrows.down = lerp(arrows.down, canFadeInDown ? downTarget : 0, downTarget > arrows.down ? 0.08 : 0.04, dt);
  if (arrows.up < 0.01) arrows.up = 0;
  if (arrows.down < 0.01) arrows.down = 0;
  if (arrows.up > 0.99) arrows.up = 1;
  if (arrows.down > 0.99) arrows.down = 1;
  const cycle = now_ms % 1400 / 1400;
  const drawChevrons = (dir, opacity) => {
    if (opacity < 0.01) return;
    const baseX = x + 19;
    const baseY = y;
    ctx.save();
    ctx.strokeStyle = palette.gridLabel;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < 2; i++) {
      const start = i * 0.2;
      const dur = 0.35;
      const localT = cycle - start;
      const wave = localT >= 0 && localT < dur ? Math.sin(localT / dur * Math.PI) : 0;
      const pulse = 0.3 + 0.7 * wave;
      ctx.globalAlpha = baseAlpha * opacity * pulse;
      const nudge = dir === -1 ? -3 : 3;
      const cy = baseY + dir * (i * 8 - 4) + nudge;
      ctx.beginPath();
      ctx.moveTo(baseX - 5, cy - dir * 3.5);
      ctx.lineTo(baseX, cy);
      ctx.lineTo(baseX + 5, cy - dir * 3.5);
      ctx.stroke();
    }
    ctx.restore();
  };
  drawChevrons(-1, arrows.up);
  drawChevrons(1, arrows.down);
  ctx.globalAlpha = baseAlpha;
}

// src/draw/crosshair.ts
function drawCrosshair(ctx, layout, palette, hoverX, hoverValue, hoverTime, formatValue, formatTime, scrubOpacity, tooltipY, liveDotX, tooltipOutline) {
  if (scrubOpacity < 0.01) return;
  const { h, pad, toY } = layout;
  const y = toY(hoverValue);
  ctx.save();
  ctx.globalAlpha = scrubOpacity * 0.5;
  ctx.strokeStyle = palette.crosshairLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hoverX, pad.top);
  ctx.lineTo(hoverX, h - pad.bottom);
  ctx.stroke();
  ctx.restore();
  const dotRadius = 4 * Math.min(scrubOpacity * 3, 1);
  if (dotRadius > 0.5) {
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(hoverX, y, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = palette.line;
    ctx.fill();
  }
  if (scrubOpacity < 0.1 || layout.w < 300) return;
  const valueText = formatValue(hoverValue);
  const timeText = formatTime(hoverTime);
  const separator = "  \xB7  ";
  ctx.save();
  ctx.globalAlpha = scrubOpacity;
  ctx.font = '400 13px "SF Mono", Menlo, monospace';
  const valueW = ctx.measureText(valueText).width;
  const sepW = ctx.measureText(separator).width;
  const timeW = ctx.measureText(timeText).width;
  const totalW = valueW + sepW + timeW;
  let tx = hoverX - totalW / 2;
  const minX = pad.left + 4;
  const dotRightEdge = liveDotX != null ? liveDotX + 7 : layout.w - pad.right;
  const maxX = dotRightEdge - totalW;
  if (tx < minX) tx = minX;
  if (tx > maxX) tx = maxX;
  const ty = pad.top + (tooltipY ?? 14) + 10;
  ctx.textAlign = "left";
  if (tooltipOutline) {
    ctx.strokeStyle = palette.tooltipBg;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.strokeText(valueText, tx, ty);
    ctx.strokeText(separator + timeText, tx + valueW, ty);
  }
  ctx.fillStyle = palette.tooltipText;
  ctx.fillText(valueText, tx, ty);
  ctx.fillStyle = palette.gridLabel;
  ctx.fillText(separator + timeText, tx + valueW, ty);
  ctx.restore();
}

// src/draw/referenceLine.ts
function drawReferenceLine(ctx, layout, palette, ref) {
  const { w, h, pad, toY, chartW } = layout;
  const y = toY(ref.value);
  if (y < pad.top - 10 || y > h - pad.bottom + 10) return;
  const label = ref.label ?? "";
  if (label) {
    ctx.font = "500 11px system-ui, sans-serif";
    const textW = ctx.measureText(label).width;
    const centerX = pad.left + chartW / 2;
    const gapPad = 8;
    ctx.strokeStyle = palette.refLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(centerX - textW / 2 - gapPad, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX + textW / 2 + gapPad, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = palette.refLabel;
    ctx.textAlign = "center";
    ctx.fillText(label, centerX, y + 4);
  } else {
    ctx.strokeStyle = palette.refLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// src/math/intervals.ts
function niceTimeInterval(windowSecs) {
  if (windowSecs <= 15) return 2;
  if (windowSecs <= 30) return 5;
  if (windowSecs <= 60) return 10;
  if (windowSecs <= 120) return 15;
  if (windowSecs <= 300) return 30;
  if (windowSecs <= 600) return 60;
  if (windowSecs <= 1800) return 300;
  if (windowSecs <= 3600) return 600;
  if (windowSecs <= 14400) return 1800;
  if (windowSecs <= 43200) return 3600;
  if (windowSecs <= 86400) return 7200;
  if (windowSecs <= 604800) return 86400;
  return 604800;
}

// src/draw/timeAxis.ts
var FADE = 0.08;
function drawTimeAxis(ctx, layout, palette, windowSecs, targetWindowSecs, formatTime, state, dt) {
  const { h, pad, leftEdge, rightEdge, toX } = layout;
  const chartLeft = pad.left;
  const chartRight = layout.w - pad.right;
  const chartW = chartRight - chartLeft;
  const fadeZone = 50;
  const edgeAlpha = (x) => {
    const fromLeft = x - chartLeft;
    const fromRight = chartRight - x;
    const fromEdge = Math.min(fromLeft, fromRight);
    if (fromEdge >= fadeZone) return 1;
    if (fromEdge <= 0) return 0;
    return fromEdge / fadeZone;
  };
  ctx.font = palette.labelFont;
  const targetPxPerSec = chartW / targetWindowSecs;
  let interval = niceTimeInterval(targetWindowSecs);
  while (interval * targetPxPerSec < 60 && interval < targetWindowSecs) {
    interval *= 2;
  }
  const useLocalDays = interval >= 86400;
  let firstTime;
  if (useLocalDays) {
    const d = new Date((leftEdge - interval) * 1e3);
    d.setHours(0, 0, 0, 0);
    firstTime = d.getTime() / 1e3;
  } else {
    firstTime = Math.ceil((leftEdge - interval) / interval) * interval;
  }
  const targets = /* @__PURE__ */ new Set();
  for (let t = firstTime; t <= rightEdge + interval && targets.size < 30; t += interval) {
    targets.add(Math.round(t * 100));
  }
  for (const key of targets) {
    const text = formatTime(key / 100);
    const existing = state.labels.get(key);
    if (!existing) {
      state.labels.set(key, { alpha: 0, text });
    } else {
      existing.text = text;
    }
  }
  for (const [key, label] of state.labels) {
    const x = toX(key / 100);
    const isTarget = targets.has(key);
    const target = isTarget ? edgeAlpha(x) : 0;
    let next = lerp(label.alpha, target, FADE, dt);
    if (Math.abs(next - target) < 0.02) next = target;
    if (next < 0.01 && target === 0) {
      state.labels.delete(key);
    } else {
      label.alpha = next;
    }
  }
  const baseAlpha = ctx.globalAlpha;
  const lineY = h - pad.bottom;
  const tickLen = 5;
  ctx.strokeStyle = palette.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chartLeft, lineY);
  ctx.lineTo(chartRight, lineY);
  ctx.stroke();
  ctx.textAlign = "center";
  const labels = [];
  for (const [key, label] of state.labels) {
    if (label.alpha < 0.02) continue;
    const x = toX(key / 100);
    if (x < chartLeft - 20 || x > chartRight) continue;
    const w = ctx.measureText(label.text).width;
    labels.push({ x, alpha: label.alpha, text: label.text, w });
  }
  labels.sort((a, b) => a.x - b.x);
  const drawn = [];
  for (const label of labels) {
    const left = label.x - label.w / 2;
    if (drawn.length > 0) {
      const prev = drawn[drawn.length - 1];
      const prevRight = prev.x + prev.w / 2;
      if (left < prevRight + 8) {
        if (label.alpha > prev.alpha) {
          drawn[drawn.length - 1] = label;
        }
        continue;
      }
    }
    drawn.push(label);
  }
  for (const label of drawn) {
    ctx.save();
    ctx.globalAlpha = baseAlpha * label.alpha;
    ctx.strokeStyle = palette.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(label.x, lineY);
    ctx.lineTo(label.x, lineY + tickLen);
    ctx.stroke();
    ctx.fillStyle = palette.timeLabel;
    ctx.fillText(label.text, label.x, lineY + tickLen + 14);
    ctx.restore();
  }
}

// src/draw/orderbook.ts
var GREEN = [34, 197, 94];
var RED = [239, 68, 68];
function createOrderbookState() {
  return {
    labels: [],
    spawnTimer: 0,
    smoothSpeed: BASE_SPEED,
    prevBidTotal: 0,
    prevAskTotal: 0,
    churnRate: 0
  };
}
var MAX_LABELS = 50;
var LABEL_LIFETIME = 6;
var SPAWN_INTERVAL = 40;
var MIN_LABEL_GAP = 22;
var BASE_SPEED = 60;
var MAX_SPEED = 160;
function mixColor(from, to, t) {
  const r = Math.round(from[0] + (to[0] - from[0]) * t);
  const g = Math.round(from[1] + (to[1] - from[1]) * t);
  const b = Math.round(from[2] + (to[2] - from[2]) * t);
  return `rgb(${r},${g},${b})`;
}
function drawOrderbook(ctx, layout, palette, orderbook, dt, state, swingMagnitude) {
  const { pad, h, chartH } = layout;
  const dtSec = dt / 1e3;
  if (orderbook.bids.length === 0 && orderbook.asks.length === 0) return;
  let maxSize = 0;
  let bidTotal = 0;
  let askTotal = 0;
  for (const [, size] of orderbook.bids) {
    bidTotal += size;
    if (size > maxSize) maxSize = size;
  }
  for (const [, size] of orderbook.asks) {
    askTotal += size;
    if (size > maxSize) maxSize = size;
  }
  if (maxSize === 0) return;
  const totalSize = bidTotal + askTotal;
  const prevTotal = state.prevBidTotal + state.prevAskTotal;
  let churnSignal = 0;
  if (prevTotal > 0) {
    const delta = Math.abs(bidTotal - state.prevBidTotal) + Math.abs(askTotal - state.prevAskTotal);
    churnSignal = Math.min(delta / prevTotal, 1);
  }
  state.prevBidTotal = bidTotal;
  state.prevAskTotal = askTotal;
  const churnLerp = churnSignal > state.churnRate ? 0.3 : 0.05;
  state.churnRate += (churnSignal - state.churnRate) * churnLerp;
  const activity = Math.max(Math.min(swingMagnitude * 5, 1), state.churnRate);
  const targetSpeed = BASE_SPEED + activity * (MAX_SPEED - BASE_SPEED);
  const speedLerp = 1 - Math.pow(0.95, dt / 16.67);
  state.smoothSpeed += (targetSpeed - state.smoothSpeed) * speedLerp;
  const speed = state.smoothSpeed;
  const labelX = pad.left + 8;
  const bottomY = h - pad.bottom - 6;
  const topY = pad.top;
  const bg = palette.bgRgb;
  state.spawnTimer += dt;
  while (state.spawnTimer >= SPAWN_INTERVAL && state.labels.length < MAX_LABELS) {
    state.spawnTimer -= SPAWN_INTERVAL;
    let tooClose = false;
    for (let j = 0; j < state.labels.length; j++) {
      if (Math.abs(state.labels[j].y - bottomY) < MIN_LABEL_GAP) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) break;
    const allLevels = [];
    for (const [, size] of orderbook.bids) allLevels.push({ size, green: true });
    for (const [, size] of orderbook.asks) allLevels.push({ size, green: false });
    let totalWeight = 0;
    for (const l of allLevels) totalWeight += l.size;
    let r = Math.random() * totalWeight;
    let picked = allLevels[0];
    for (const l of allLevels) {
      r -= l.size;
      if (r <= 0) {
        picked = l;
        break;
      }
    }
    const sizeRatio = picked.size / maxSize;
    state.labels.push({
      y: bottomY,
      text: `+ ${formatSize(picked.size)}`,
      green: picked.green,
      life: LABEL_LIFETIME,
      maxLife: LABEL_LIFETIME,
      intensity: 0.5 + sizeRatio * 0.5
    });
  }
  const range = bottomY - topY;
  let writeIdx = 0;
  for (let i = 0; i < state.labels.length; i++) {
    const l = state.labels[i];
    l.life -= dtSec;
    if (l.life <= 0) continue;
    const yProgress = range > 0 ? (l.y - topY) / range : 1;
    l.y -= speed * (0.7 + 0.3 * yProgress) * dtSec;
    if (l.y < topY - 14) continue;
    state.labels[writeIdx++] = l;
  }
  state.labels.length = writeIdx;
  const baseAlpha = ctx.globalAlpha;
  ctx.save();
  ctx.font = '600 13px "SF Mono", Menlo, monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = baseAlpha;
  const outlineColor = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
  for (let i = 0; i < state.labels.length; i++) {
    const l = state.labels[i];
    const lifeRatio = l.life / l.maxLife;
    const fadeIn = Math.min((1 - lifeRatio) * 10, 1);
    const yRatio = (l.y - topY) / chartH;
    const fadeOut = yRatio < 0.45 ? yRatio / 0.45 : 1;
    const colorStrength = l.intensity * fadeIn * fadeOut;
    const baseColor = l.green ? GREEN : RED;
    const fillColor = mixColor(baseColor, bg, 1 - colorStrength);
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeText(l.text, labelX, l.y);
    ctx.fillStyle = fillColor;
    ctx.fillText(l.text, labelX, l.y);
  }
  ctx.restore();
}
function formatSize(size) {
  if (size >= 10) return `$${Math.round(size)}`;
  if (size >= 1) return `$${size.toFixed(1)}`;
  return `$${size.toFixed(2)}`;
}

// src/draw/particles.ts
function createParticleState() {
  return { particles: [], cooldown: 0, burstCount: 0 };
}
var MAX_PARTICLES = 80;
var PARTICLE_LIFETIME = 1;
var COOLDOWN_MS = 400;
var MAGNITUDE_THRESHOLD = 0.08;
var MAX_BURSTS = 3;
function spawnOnSwing(state, momentum, dotX, dotY, swingMagnitude, accentColor, dt, options) {
  state.cooldown = Math.max(0, state.cooldown - dt);
  if (momentum === "flat") return 0;
  if (state.cooldown > 0) return 0;
  if (swingMagnitude < MAGNITUDE_THRESHOLD) {
    state.burstCount = 0;
    return 0;
  }
  if (momentum === "down" && options?.downMomentum !== true) return 0;
  if (state.burstCount >= MAX_BURSTS) return 0;
  state.cooldown = COOLDOWN_MS;
  const scale = options?.scale ?? 1;
  const isUp = momentum === "up";
  const mag = Math.min(swingMagnitude * 5, 1);
  const burstFalloff = mag > 0.6 ? 1 : [1, 0.6, 0.35][state.burstCount] ?? 0.35;
  state.burstCount++;
  const count = Math.round((12 + mag * 20) * scale * burstFalloff);
  const speedMultiplier = 1 + mag * 0.8;
  for (let i = 0; i < count && state.particles.length < MAX_PARTICLES; i++) {
    const baseAngle = isUp ? -Math.PI / 2 : Math.PI / 2;
    const spread = Math.PI * 1.2;
    const angle = baseAngle + (Math.random() - 0.5) * spread;
    const speed = (60 + Math.random() * 100) * speedMultiplier;
    state.particles.push({
      x: dotX + (Math.random() - 0.5) * 24,
      y: dotY + (Math.random() - 0.5) * 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      size: (1 + Math.random() * 1.2) * scale * burstFalloff,
      color: accentColor
    });
  }
  return burstFalloff;
}
function drawParticles(ctx, state, dt) {
  if (state.particles.length === 0) return;
  const dtSec = dt / 1e3;
  ctx.save();
  let writeIdx = 0;
  for (let i = 0; i < state.particles.length; i++) {
    const p = state.particles[i];
    p.life -= dtSec / PARTICLE_LIFETIME;
    if (p.life <= 0) continue;
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    p.vx *= 0.95;
    p.vy *= 0.95;
    ctx.globalAlpha = p.life * 0.55;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.5 + p.life * 0.5), 0, Math.PI * 2);
    ctx.fill();
    state.particles[writeIdx++] = p;
  }
  state.particles.length = writeIdx;
  ctx.restore();
}

// src/draw/candlestick.ts
var BULL = "#22c55e";
var BEAR = "#ef4444";
var BULL_RGB = [34, 197, 94];
var BEAR_RGB = [239, 68, 68];
function blendColor2(t, bearRgb, bullRgb) {
  const r = Math.round(bearRgb[0] + (bullRgb[0] - bearRgb[0]) * t);
  const g = Math.round(bearRgb[1] + (bullRgb[1] - bearRgb[1]) * t);
  const b = Math.round(bearRgb[2] + (bullRgb[2] - bearRgb[2]) * t);
  return `rgb(${r},${g},${b})`;
}
function parseRgb(color, fallback) {
  const shortHex = color.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split("");
    return [
      parseInt(`${r}${r}`, 16),
      parseInt(`${g}${g}`, 16),
      parseInt(`${b}${b}`, 16)
    ];
  }
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return [fallback[0], fallback[1], fallback[2]];
}
function resolveCandleColors(bullColor, bearColor) {
  const bull = bullColor ?? BULL;
  const bear = bearColor ?? BEAR;
  return {
    bull,
    bear,
    bullRgb: parseRgb(bull, BULL_RGB),
    bearRgb: parseRgb(bear, BEAR_RGB)
  };
}
function blendToAccent(candleColor, accentColor, t) {
  if (t <= 0) return candleColor;
  if (t >= 1) return accentColor;
  const [r1, g1, b1] = parseRgb(candleColor, [128, 128, 128]);
  const [r2, g2, b2] = parseRgb(accentColor, [128, 128, 128]);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}
function candleDims(layout, candleWidthSecs) {
  const pxPerSec = layout.chartW / (layout.rightEdge - layout.leftEdge);
  const candlePxW = candleWidthSecs * pxPerSec;
  const bodyW = Math.max(1, candlePxW * 0.7);
  const wickW = Math.max(0.8, Math.min(2, bodyW * 0.15));
  const radius = bodyW > 6 ? 1.5 : 0;
  return { bodyW, wickW, radius };
}
function roundedRect(ctx, x, y, w, h, r) {
  if (r <= 0 || h < r * 2) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
function drawCandlesticks(ctx, layout, candles, candleWidthSecs, liveTime, now_ms, scrubX, scrubDim, liveAlpha = 1, liveBullBlend = -1, bullColor, bearColor, accentColor, accentBlend = 0) {
  if (candles.length === 0) return;
  const { toX, toY } = layout;
  const { bodyW, wickW, radius } = candleDims(layout, candleWidthSecs);
  const halfBody = bodyW / 2;
  const padL = layout.pad.left;
  const padR = layout.pad.left + layout.chartW;
  const { bull, bear, bullRgb, bearRgb } = resolveCandleColors(bullColor, bearColor);
  const livePulse = 0.12 + Math.sin(now_ms * 4e-3) * 0.08;
  for (const c of candles) {
    const cx = toX(c.time + candleWidthSecs / 2);
    if (cx + halfBody < padL || cx - halfBody > padR) continue;
    const isBull = c.close >= c.open;
    const isLive = c.time === liveTime;
    let color = isLive && liveBullBlend >= 0 ? blendColor2(liveBullBlend, bearRgb, bullRgb) : isBull ? bull : bear;
    if (accentColor && accentBlend > 0.01) {
      color = blendToAccent(color, accentColor, accentBlend);
    }
    let candleAlpha = isLive ? liveAlpha : 1;
    if (scrubDim > 0.01 && scrubX > 0) {
      const dist = cx - scrubX;
      if (dist > 0) {
        const fadeZone = bodyW * 1.5;
        const dimT = Math.min(dist / fadeZone, 1);
        candleAlpha *= 1 - scrubDim * 0.5 * dimT;
      }
    }
    const baseAlpha = ctx.globalAlpha;
    ctx.globalAlpha = baseAlpha * candleAlpha;
    const bodyTop = toY(Math.max(c.open, c.close));
    const bodyBottom = toY(Math.min(c.open, c.close));
    const bodyH = Math.max(1, bodyBottom - bodyTop);
    const wickTop = toY(c.high);
    const wickBottom = toY(c.low);
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    if (bodyTop - wickTop > 0.5) {
      ctx.beginPath();
      ctx.moveTo(cx, bodyTop);
      ctx.lineTo(cx, wickTop);
      ctx.lineWidth = wickW;
      ctx.stroke();
    }
    if (wickBottom - bodyBottom > 0.5) {
      ctx.beginPath();
      ctx.moveTo(cx, bodyBottom);
      ctx.lineTo(cx, wickBottom);
      ctx.lineWidth = wickW;
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    roundedRect(ctx, cx - halfBody, bodyTop, bodyW, bodyH, radius);
    ctx.fill();
    if (isLive) {
      ctx.save();
      ctx.globalAlpha = baseAlpha * candleAlpha * livePulse;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = color;
      ctx.beginPath();
      roundedRect(ctx, cx - halfBody, bodyTop, bodyW, bodyH, radius);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = baseAlpha;
  }
}
function drawClosePrice(ctx, layout, palette, liveCandle, scrubDim, bullBlend = -1, bullColor, bearColor) {
  const y = layout.toY(liveCandle.close);
  if (y < layout.pad.top || y > layout.h - layout.pad.bottom) return;
  const isBull = liveCandle.close >= liveCandle.open;
  const { bull, bear, bullRgb, bearRgb } = resolveCandleColors(bullColor, bearColor);
  const color = bullBlend >= 0 ? blendColor2(bullBlend, bearRgb, bullRgb) : isBull ? bull : bear;
  const baseAlpha = ctx.globalAlpha;
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = baseAlpha * (1 - scrubDim * 0.3) * 0.4;
  ctx.beginPath();
  ctx.moveTo(layout.pad.left, y);
  ctx.lineTo(layout.w - layout.pad.right, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}
function drawCandleCrosshair(ctx, layout, palette, hoverX, candle, hoverTime, formatValue, formatTime, opacity, bullColor, bearColor) {
  if (opacity < 0.01) return;
  const { h, pad } = layout;
  ctx.save();
  ctx.globalAlpha = opacity * 0.5;
  ctx.strokeStyle = palette.crosshairLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hoverX, pad.top);
  ctx.lineTo(hoverX, h - pad.bottom);
  ctx.stroke();
  ctx.restore();
  if (opacity < 0.1 || layout.w < 200) return;
  const isBull = candle.close >= candle.open;
  const { bull, bear } = resolveCandleColors(bullColor, bearColor);
  const valueColor = isBull ? bull : bear;
  const cl = formatValue(candle.close);
  const time = formatTime(hoverTime);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = '400 13px "SF Mono", Menlo, monospace';
  ctx.textAlign = "left";
  let parts;
  if (layout.w >= 400) {
    const o = formatValue(candle.open);
    const hi = formatValue(candle.high);
    const lo = formatValue(candle.low);
    parts = [
      { text: "O ", color: palette.gridLabel },
      { text: o, color: valueColor },
      { text: "   H ", color: palette.gridLabel },
      { text: hi, color: valueColor },
      { text: "   L ", color: palette.gridLabel },
      { text: lo, color: valueColor },
      { text: "   C ", color: palette.gridLabel },
      { text: cl, color: valueColor },
      { text: "  \xB7  ", color: palette.gridLabel },
      { text: time, color: palette.gridLabel }
    ];
  } else {
    parts = [
      { text: "C ", color: palette.gridLabel },
      { text: cl, color: valueColor },
      { text: "  \xB7  ", color: palette.gridLabel },
      { text: time, color: palette.gridLabel }
    ];
  }
  let totalW = 0;
  const widths = [];
  for (const p of parts) {
    const w = ctx.measureText(p.text).width;
    widths.push(w);
    totalW += w;
  }
  let tx = hoverX - totalW / 2;
  const minX = pad.left + 4;
  const maxX = layout.w - pad.right - totalW;
  if (tx < minX) tx = minX;
  if (tx > maxX) tx = maxX;
  const ty = pad.top + 24;
  ctx.strokeStyle = palette.tooltipBg;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  let cx = tx;
  for (let i = 0; i < parts.length; i++) {
    ctx.strokeText(parts[i].text, cx, ty);
    cx += widths[i];
  }
  cx = tx;
  for (let i = 0; i < parts.length; i++) {
    ctx.fillStyle = parts[i].color;
    ctx.fillText(parts[i].text, cx, ty);
    cx += widths[i];
  }
  ctx.restore();
}
function drawLineModeCrosshair(ctx, layout, palette, hoverX, value, hoverTime, formatValue, formatTime, opacity) {
  if (opacity < 0.01) return;
  const { h, pad } = layout;
  const y = layout.toY(value);
  ctx.save();
  ctx.globalAlpha = opacity * 0.5;
  ctx.strokeStyle = palette.crosshairLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hoverX, pad.top);
  ctx.lineTo(hoverX, h - pad.bottom);
  ctx.stroke();
  ctx.globalAlpha = opacity * 0.3;
  ctx.beginPath();
  ctx.moveTo(pad.left, y);
  ctx.lineTo(layout.w - pad.right, y);
  ctx.stroke();
  ctx.restore();
  if (opacity < 0.1 || layout.w < 200) return;
  const val = formatValue(value);
  const time = formatTime(hoverTime);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = '400 13px "SF Mono", Menlo, monospace';
  ctx.textAlign = "left";
  const parts = [
    { text: val, color: palette.line },
    { text: "  \xB7  ", color: palette.gridLabel },
    { text: time, color: palette.gridLabel }
  ];
  let totalW = 0;
  const widths = [];
  for (const p of parts) {
    const w = ctx.measureText(p.text).width;
    widths.push(w);
    totalW += w;
  }
  let tx = hoverX - totalW / 2;
  const minX = pad.left + 4;
  const maxX = layout.w - pad.right - totalW;
  if (tx < minX) tx = minX;
  if (tx > maxX) tx = maxX;
  const ty = pad.top + 24;
  ctx.strokeStyle = palette.tooltipBg;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  let lx = tx;
  for (let i = 0; i < parts.length; i++) {
    ctx.strokeText(parts[i].text, lx, ty);
    lx += widths[i];
  }
  lx = tx;
  for (let i = 0; i < parts.length; i++) {
    ctx.fillStyle = parts[i].color;
    ctx.fillText(parts[i].text, lx, ty);
    lx += widths[i];
  }
  ctx.restore();
}

// src/draw/empty.ts
function drawEmpty(ctx, w, h, pad, palette, alpha = 1, now_ms = 0, skipLine = false, emptyText) {
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const centerY = pad.top + chartH / 2;
  const cx = pad.left + chartW / 2;
  const text = emptyText ?? "No data to display";
  const amplitude = chartH * LOADING_AMPLITUDE_RATIO;
  ctx.save();
  ctx.font = "400 12px system-ui, -apple-system, sans-serif";
  const textW = ctx.measureText(text).width;
  const gapHalf = textW / 2 + 20;
  const fadeW = 30;
  if (!skipLine) {
    const scroll = now_ms * LOADING_SCROLL_SPEED;
    const breath = loadingBreath(now_ms);
    const numPts = 32;
    const pts = [];
    for (let i = 0; i <= numPts; i++) {
      const t = i / numPts;
      const x = pad.left + t * chartW;
      const y = loadingY(t, centerY, amplitude, scroll);
      pts.push([x, y]);
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    drawSpline(ctx, pts);
    ctx.strokeStyle = palette.gridLabel;
    ctx.lineWidth = palette.lineWidth;
    ctx.globalAlpha = breath * alpha;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  const gapLeft = cx - gapHalf - fadeW;
  const gapRight = cx + gapHalf + fadeW;
  const eraseGrad = ctx.createLinearGradient(gapLeft, 0, gapRight, 0);
  eraseGrad.addColorStop(0, "rgba(0,0,0,0)");
  eraseGrad.addColorStop(fadeW / (gapRight - gapLeft), "rgba(0,0,0,1)");
  eraseGrad.addColorStop(1 - fadeW / (gapRight - gapLeft), "rgba(0,0,0,1)");
  eraseGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = eraseGrad;
  ctx.globalAlpha = alpha;
  const eraseH = amplitude * 2 + palette.lineWidth + 6;
  ctx.fillRect(gapLeft, centerY - eraseH / 2, gapRight - gapLeft, eraseH);
  ctx.restore();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = 0.35 * alpha;
  ctx.fillStyle = palette.gridLabel;
  ctx.fillText(text, cx, centerY);
  ctx.restore();
}

// src/draw/index.ts
var SHAKE_DECAY_RATE = 2e-3;
var SHAKE_MIN_AMPLITUDE = 0.2;
var FADE_EDGE_WIDTH = 40;
var CROSSHAIR_FADE_MIN_PX = 5;
function createShakeState() {
  return { amplitude: 0 };
}
function drawFrame(ctx, layout, palette, opts) {
  const shake = opts.shakeState;
  let shakeX = 0;
  let shakeY = 0;
  if (shake && shake.amplitude > SHAKE_MIN_AMPLITUDE) {
    shakeX = (Math.random() - 0.5) * 2 * shake.amplitude;
    shakeY = (Math.random() - 0.5) * 2 * shake.amplitude;
    ctx.save();
    ctx.translate(shakeX, shakeY);
  }
  if (shake) {
    const decayRate = Math.pow(SHAKE_DECAY_RATE, opts.dt / 1e3);
    shake.amplitude *= decayRate;
    if (shake.amplitude < SHAKE_MIN_AMPLITUDE) shake.amplitude = 0;
  }
  const reveal = opts.chartReveal;
  const pause = opts.pauseProgress;
  const revealRamp = (start, end) => {
    const t = Math.max(0, Math.min(1, (reveal - start) / (end - start)));
    return t * t * (3 - 2 * t);
  };
  if (opts.referenceLine && reveal > 0.01) {
    ctx.save();
    if (reveal < 1) ctx.globalAlpha = reveal;
    drawReferenceLine(ctx, layout, palette, opts.referenceLine);
    ctx.restore();
  }
  if (opts.showGrid) {
    const gridAlpha = reveal < 1 ? revealRamp(0.15, 0.7) : 1;
    if (gridAlpha > 0.01) {
      ctx.save();
      if (gridAlpha < 1) ctx.globalAlpha = gridAlpha;
      drawGrid(ctx, layout, palette, opts.formatValue, opts.gridState, opts.dt);
      ctx.restore();
    }
  }
  if (opts.orderbookData && opts.orderbookState && reveal > 0.01) {
    ctx.save();
    if (reveal < 1) ctx.globalAlpha = reveal;
    drawOrderbook(ctx, layout, palette, opts.orderbookData, opts.dt, opts.orderbookState, opts.swingMagnitude);
    ctx.restore();
  }
  const scrubX = opts.scrubAmount > 0.05 ? opts.hoverX : null;
  const pts = drawLine(ctx, layout, palette, opts.visible, opts.smoothValue, opts.now, opts.showFill, scrubX, opts.scrubAmount, reveal, opts.now_ms);
  {
    const timeAlpha = reveal < 1 ? revealRamp(0.15, 0.7) : 1;
    if (timeAlpha > 0.01) {
      ctx.save();
      if (timeAlpha < 1) ctx.globalAlpha = timeAlpha;
      drawTimeAxis(ctx, layout, palette, opts.windowSecs, opts.targetWindowSecs, opts.formatTime, opts.timeAxisState, opts.dt);
      ctx.restore();
    }
  }
  if (pts && pts.length > 0) {
    const lastPt = pts[pts.length - 1];
    let dotScrub = opts.scrubAmount;
    if (opts.hoverX !== null && dotScrub > 0) {
      const distToLive = lastPt[0] - opts.hoverX;
      const fadeStart = Math.min(80, layout.chartW * 0.3);
      dotScrub = distToLive < CROSSHAIR_FADE_MIN_PX ? 0 : distToLive >= fadeStart ? opts.scrubAmount : (distToLive - CROSSHAIR_FADE_MIN_PX) / (fadeStart - CROSSHAIR_FADE_MIN_PX) * opts.scrubAmount;
    }
    const dotAlpha = reveal < 0.3 ? 0 : (reveal - 0.3) / 0.7;
    const showPulse = opts.showPulse && reveal > 0.6 && pause < 0.5;
    if (dotAlpha > 0.01) {
      ctx.save();
      if (dotAlpha < 1) ctx.globalAlpha = dotAlpha;
      drawDot(ctx, lastPt[0], lastPt[1], palette, showPulse, dotScrub, opts.now_ms);
      ctx.restore();
    }
    if (opts.showMomentum) {
      const arrowReveal = reveal < 1 ? revealRamp(0.6, 1) : 1;
      const arrowAlpha = arrowReveal * (1 - pause);
      if (arrowAlpha > 0.01) {
        ctx.save();
        if (arrowAlpha < 1) ctx.globalAlpha = arrowAlpha;
        drawArrows(
          ctx,
          lastPt[0],
          lastPt[1],
          opts.momentum,
          palette,
          opts.arrowState,
          opts.dt,
          opts.now_ms
        );
        ctx.restore();
      }
    }
    if (opts.particleState && reveal > 0.9) {
      const burstIntensity = spawnOnSwing(
        opts.particleState,
        opts.momentum,
        lastPt[0],
        lastPt[1],
        opts.swingMagnitude,
        palette.line,
        opts.dt,
        opts.particleOptions
      );
      if (burstIntensity > 0 && shake) {
        shake.amplitude = (3 + opts.swingMagnitude * 4) * burstIntensity;
      }
      drawParticles(ctx, opts.particleState, opts.dt);
    }
  }
  const fadeW = FADE_EDGE_WIDTH;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  const fadeGrad = ctx.createLinearGradient(layout.pad.left, 0, layout.pad.left + fadeW, 0);
  fadeGrad.addColorStop(0, "rgba(0, 0, 0, 1)");
  fadeGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = fadeGrad;
  ctx.fillRect(0, 0, layout.pad.left + fadeW, layout.h);
  ctx.restore();
  if (opts.hoverX !== null && opts.hoverValue !== null && opts.hoverTime !== null && pts && pts.length > 0) {
    const lastPt = pts[pts.length - 1];
    const distToLive = lastPt[0] - opts.hoverX;
    const fadeStart = Math.min(80, layout.chartW * 0.3);
    const scrubOpacity = distToLive < CROSSHAIR_FADE_MIN_PX ? 0 : distToLive >= fadeStart ? opts.scrubAmount : (distToLive - CROSSHAIR_FADE_MIN_PX) / (fadeStart - CROSSHAIR_FADE_MIN_PX) * opts.scrubAmount;
    if (scrubOpacity > 0.01) {
      drawCrosshair(
        ctx,
        layout,
        palette,
        opts.hoverX,
        opts.hoverValue,
        opts.hoverTime,
        opts.formatValue,
        opts.formatTime,
        scrubOpacity,
        opts.tooltipY,
        lastPt[0],
        // liveDotX — tooltip right edge stops here
        opts.tooltipOutline
      );
    }
  }
  if (shake && (shakeX !== 0 || shakeY !== 0)) {
    ctx.restore();
  }
}
function drawCandleFrame(ctx, layout, palette, opts) {
  const { w, h, pad, chartW, chartH } = layout;
  const reveal = opts.chartReveal;
  const fullLineMode = opts.lineModeProg >= 0.99;
  const revealLine = fullLineMode ? 1 - reveal : (1 - reveal) * (1 - reveal) * (1 - reveal);
  const lp = Math.max(opts.lineModeProg, revealLine);
  const colorBlend = lp > 1e-3 ? opts.lineModeProg / lp : 1;
  const revealRamp = (start, end) => {
    const t = Math.max(0, Math.min(1, (reveal - start) / (end - start)));
    return t * t * (3 - 2 * t);
  };
  const gridAlpha = revealRamp(0.25, 0.6);
  if (opts.showGrid && gridAlpha > 0.01) {
    ctx.save();
    if (gridAlpha < 1) ctx.globalAlpha = gridAlpha;
    drawGrid(ctx, layout, palette, opts.formatValue, opts.gridState, opts.dt);
    ctx.restore();
  }
  let linePts;
  if (lp > 0.01 && opts.lineVisible.length >= 2) {
    const scrubX = opts.scrubAmount > 0.05 ? opts.hoverX : null;
    ctx.save();
    ctx.globalAlpha = lp;
    linePts = drawLine(
      ctx,
      layout,
      palette,
      opts.lineVisible,
      opts.lineSmoothValue,
      opts.now,
      opts.lineModeProg > 0.01,
      scrubX,
      opts.scrubAmount,
      opts.chartReveal,
      opts.now_ms,
      colorBlend,
      !fullLineMode,
      opts.lineModeProg
      // fillScale — fill fades smoothly with line mode transition
    );
    ctx.restore();
  }
  const closeAlpha = revealRamp(0.4, 0.8);
  const closeSource = opts.closePriceCandle ?? opts.liveCandle;
  if (closeSource && closeAlpha > 0.01) {
    if (lp < 0.99) {
      ctx.save();
      ctx.globalAlpha = closeAlpha * (1 - lp);
      drawClosePrice(
        ctx,
        layout,
        palette,
        closeSource,
        opts.scrubAmount,
        opts.liveBullBlend,
        opts.bullColor,
        opts.bearColor
      );
      ctx.restore();
    }
    if (lp > 0.01 && !fullLineMode) {
      const dashY = layout.toY(closeSource.close);
      if (dashY >= pad.top && dashY <= h - pad.bottom) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = palette.dashLine;
        ctx.lineWidth = 1;
        ctx.globalAlpha = closeAlpha * lp * (1 - opts.scrubAmount * 0.2);
        ctx.beginPath();
        ctx.moveTo(pad.left, dashY);
        ctx.lineTo(w - pad.right, dashY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }
  const candleAlpha = opts.chartReveal * (1 - lp);
  if (candleAlpha > 0.01) {
    const ohlcScale = reveal * reveal * (3 - 2 * reveal);
    const collapseC = (c) => ohlcScale >= 0.99 ? c : {
      time: c.time,
      open: c.close + (c.open - c.close) * ohlcScale,
      high: c.close + (c.high - c.close) * ohlcScale,
      low: c.close + (c.low - c.close) * ohlcScale,
      close: c.close
    };
    const revealCandles = ohlcScale < 0.99 ? opts.candles.map(collapseC) : opts.candles;
    const revealOld = ohlcScale < 0.99 && opts.oldCandles.length > 0 ? opts.oldCandles.map(collapseC) : opts.oldCandles;
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left - 1, pad.top, chartW + 2, chartH);
    ctx.clip();
    const accentCol = lp > 0.01 ? palette.line : void 0;
    if (opts.morphT >= 0 && revealOld.length > 0) {
      ctx.globalAlpha = (1 - opts.morphT) * candleAlpha;
      drawCandlesticks(
        ctx,
        layout,
        revealOld,
        opts.oldWidth,
        -1,
        opts.now_ms,
        opts.hoverX ?? 0,
        opts.scrubAmount,
        1,
        -1,
        opts.bullColor,
        opts.bearColor,
        accentCol,
        lp
      );
      ctx.globalAlpha = opts.morphT * candleAlpha;
      drawCandlesticks(
        ctx,
        layout,
        revealCandles,
        opts.displayCandleWidth,
        opts.liveCandle?.time ?? -1,
        opts.now_ms,
        opts.hoverX ?? 0,
        opts.scrubAmount,
        opts.liveBirthAlpha,
        opts.liveBullBlend,
        opts.bullColor,
        opts.bearColor,
        accentCol,
        lp
      );
      ctx.globalAlpha = 1;
    } else {
      if (candleAlpha < 1) ctx.globalAlpha = candleAlpha;
      drawCandlesticks(
        ctx,
        layout,
        revealCandles,
        opts.displayCandleWidth,
        opts.liveCandle?.time ?? -1,
        opts.now_ms,
        opts.hoverX ?? 0,
        opts.scrubAmount,
        opts.liveBirthAlpha,
        opts.liveBullBlend,
        opts.bullColor,
        opts.bearColor,
        accentCol,
        lp
      );
    }
    ctx.restore();
  }
  if (lp > 0.5 && linePts && linePts.length > 0 && reveal > 0.3) {
    const lastPt = linePts[linePts.length - 1];
    const dotAlpha = (lp - 0.5) * 2 * ((reveal - 0.3) / 0.7);
    const showPulse = lp > 0.8 && reveal > 0.6;
    if (dotAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = dotAlpha;
      drawDot(ctx, lastPt[0], lastPt[1], palette, showPulse, opts.scrubAmount, opts.now_ms);
      ctx.restore();
    }
  }
  const timeAlpha = revealRamp(0.25, 0.6);
  if (timeAlpha > 0.01) {
    ctx.save();
    if (timeAlpha < 1) ctx.globalAlpha = timeAlpha;
    drawTimeAxis(ctx, layout, palette, opts.targetWindowSecs, opts.targetWindowSecs, opts.formatTime, opts.timeAxisState, opts.dt);
    ctx.restore();
  }
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  const fadeGrad = ctx.createLinearGradient(pad.left, 0, pad.left + FADE_EDGE_WIDTH, 0);
  fadeGrad.addColorStop(0, "rgba(0, 0, 0, 1)");
  fadeGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = fadeGrad;
  ctx.fillRect(0, 0, pad.left + FADE_EDGE_WIDTH, h);
  ctx.restore();
  if (opts.showEmptyOverlay) {
    const bgAlpha = 1 - opts.chartReveal;
    if (bgAlpha > 0.01) {
      const bgEmptyAlpha = (1 - opts.loadingAlpha) * bgAlpha;
      if (bgEmptyAlpha > 0.01) {
        drawEmpty(ctx, w, h, pad, palette, bgEmptyAlpha, opts.now_ms, true, opts.emptyText);
      }
    }
  }
  if (opts.chartReveal > 0.7 && opts.hoveredCandle && opts.hoverX !== null && opts.scrubAmount > 0.01) {
    if (opts.lineModeProg > 0.5) {
      drawLineModeCrosshair(
        ctx,
        layout,
        palette,
        opts.hoverX,
        opts.hoveredCandle.close,
        opts.hoverTime ?? 0,
        opts.formatValue,
        opts.formatTime,
        opts.scrubAmount
      );
    } else {
      drawCandleCrosshair(
        ctx,
        layout,
        palette,
        opts.hoverX,
        opts.hoveredCandle,
        opts.hoverTime ?? 0,
        opts.formatValue,
        opts.formatTime,
        opts.scrubAmount,
        opts.bullColor,
        opts.bearColor
      );
    }
  }
}

// src/draw/loading.ts
function drawLoading(ctx, w, h, pad, palette, now_ms, alpha = 1, strokeColor) {
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const centerY = pad.top + chartH / 2;
  const leftX = pad.left;
  const amplitude = chartH * LOADING_AMPLITUDE_RATIO;
  const scroll = now_ms * LOADING_SCROLL_SPEED;
  const breath = loadingBreath(now_ms);
  const numPts = 32;
  const pts = [];
  for (let i = 0; i <= numPts; i++) {
    const t = i / numPts;
    const x = leftX + t * chartW;
    const y = loadingY(t, centerY, amplitude, scroll);
    pts.push([x, y]);
  }
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  drawSpline(ctx, pts);
  ctx.strokeStyle = strokeColor ?? palette.line;
  ctx.lineWidth = palette.lineWidth;
  ctx.globalAlpha = breath * alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

// src/draw/badge.ts
function badgeSvgPath(pillW, pillH, tailLen, tailSpread) {
  const r = pillH / 2;
  const cx = tailLen + pillW - r;
  const tl = tailLen + r;
  return [
    `M${tl},0`,
    `L${cx},0`,
    `A${r},${r},0,0,1,${cx},${pillH}`,
    `L${tl},${pillH}`,
    `C${tailLen + 2},${pillH},${3},${r + tailSpread},0,${r}`,
    `C${3},${r - tailSpread},${tailLen + 2},0,${tl},0`,
    "Z"
  ].join(" ");
}
function badgePillOnly(pillW, pillH) {
  const r = pillH / 2;
  return [
    `M${r},0`,
    `L${pillW - r},0`,
    `A${r},${r},0,0,1,${pillW - r},${pillH}`,
    `L${r},${pillH}`,
    `A${r},${r},0,0,1,${r},0`,
    "Z"
  ].join(" ");
}
var BADGE_PAD_X = 10;
var BADGE_PAD_Y = 3;
var BADGE_TAIL_LEN = 5;
var BADGE_TAIL_SPREAD = 2.5;
var BADGE_LINE_H = 16;

// src/useLivelineEngine.ts
var SVG_NS = "http://www.w3.org/2000/svg";
var MAX_DELTA_MS = 50;
var SCRUB_LERP_SPEED = 0.12;
var BADGE_WIDTH_LERP = 0.15;
var BADGE_Y_LERP = 0.35;
var BADGE_Y_LERP_TRANSITIONING = 0.5;
var MOMENTUM_COLOR_LERP = 0.12;
var WINDOW_TRANSITION_MS = 750;
var WINDOW_BUFFER = 0.05;
var VALUE_SNAP_THRESHOLD = 1e-3;
var ADAPTIVE_SPEED_BOOST = 0.2;
var MOMENTUM_GREEN = [34, 197, 94];
var MOMENTUM_RED = [239, 68, 68];
var CHART_REVEAL_SPEED = 0.14;
var CHART_REVEAL_SPEED_FWD = 0.09;
var PAUSE_PROGRESS_SPEED = 0.12;
var PAUSE_CATCHUP_SPEED = 0.08;
var PAUSE_CATCHUP_SPEED_FAST = 0.22;
var LOADING_ALPHA_SPEED = 0.14;
var CANDLE_LERP_SPEED = 0.25;
var CANDLE_WIDTH_TRANS_MS = 300;
var LINE_MORPH_MS = 500;
var CLOSE_LINE_LERP_SPEED = 0.25;
var LINE_DENSITY_MS = 350;
var LINE_LERP_BASE = 0.08;
var LINE_ADAPTIVE_BOOST = 0.2;
var LINE_SNAP_THRESHOLD = 1e-3;
var RANGE_LERP_SPEED = 0.15;
var RANGE_ADAPTIVE_BOOST = 0.2;
var CANDLE_BUFFER = 0.05;
function computeAdaptiveSpeed(value, displayValue, displayMin, displayMax, lerpSpeed, noMotion) {
  const valGap = Math.abs(value - displayValue);
  const prevRange = displayMax - displayMin || 1;
  const gapRatio = Math.min(valGap / prevRange, 1);
  return noMotion ? 1 : lerpSpeed + (1 - gapRatio) * ADAPTIVE_SPEED_BOOST;
}
function updateWindowTransition(cfg, wt, displayWindow, displayMin, displayMax, noMotion, now_ms, now, points, smoothValue, buffer) {
  if (wt.to !== cfg.windowSecs) {
    wt.from = displayWindow;
    wt.to = cfg.windowSecs;
    wt.startMs = now_ms;
    wt.rangeFromMin = displayMin;
    wt.rangeFromMax = displayMax;
    const targetRightEdge = now + cfg.windowSecs * buffer;
    const targetLeftEdge = targetRightEdge - cfg.windowSecs;
    const targetVisible = [];
    for (const p of points) {
      if (p.time >= targetLeftEdge - 2 && p.time <= targetRightEdge) {
        targetVisible.push(p);
      }
    }
    if (targetVisible.length > 0) {
      const targetRange = computeRange(targetVisible, smoothValue, cfg.referenceLine?.value, cfg.exaggerate);
      wt.rangeToMin = targetRange.min;
      wt.rangeToMax = targetRange.max;
    }
  }
  let windowTransProgress = 0;
  let resultWindow;
  if (noMotion || wt.startMs === 0) {
    resultWindow = cfg.windowSecs;
  } else {
    const elapsed = now_ms - wt.startMs;
    const duration = WINDOW_TRANSITION_MS;
    const t = Math.min(elapsed / duration, 1);
    const eased = (1 - Math.cos(t * Math.PI)) / 2;
    windowTransProgress = eased;
    const logFrom = Math.log(wt.from);
    const logTo = Math.log(wt.to);
    resultWindow = Math.exp(logFrom + (logTo - logFrom) * eased);
    if (t >= 1) {
      resultWindow = cfg.windowSecs;
      wt.startMs = 0;
      windowTransProgress = 0;
    }
  }
  return { windowSecs: resultWindow, windowTransProgress };
}
function updateRange(computedRange, rangeInited, targetMin, targetMax, displayMin, displayMax, isTransitioning, windowTransProgress, wt, adaptiveSpeed, chartH, dt) {
  if (!rangeInited) {
    return {
      minVal: computedRange.min,
      maxVal: computedRange.max,
      valRange: computedRange.max - computedRange.min || 1e-3,
      targetMin: computedRange.min,
      targetMax: computedRange.max,
      displayMin: computedRange.min,
      displayMax: computedRange.max,
      rangeInited: true
    };
  }
  if (isTransitioning) {
    displayMin = wt.rangeFromMin + (wt.rangeToMin - wt.rangeFromMin) * windowTransProgress;
    displayMax = wt.rangeFromMax + (wt.rangeToMax - wt.rangeFromMax) * windowTransProgress;
    targetMin = computedRange.min;
    targetMax = computedRange.max;
  } else {
    const curRange = displayMax - displayMin;
    targetMin = computedRange.min;
    targetMax = computedRange.max;
    displayMin = lerp(displayMin, targetMin, adaptiveSpeed, dt);
    displayMax = lerp(displayMax, targetMax, adaptiveSpeed, dt);
    const pxThreshold = 0.5 * curRange / chartH || 1e-3;
    if (Math.abs(displayMin - targetMin) < pxThreshold) displayMin = targetMin;
    if (Math.abs(displayMax - targetMax) < pxThreshold) displayMax = targetMax;
  }
  return {
    minVal: displayMin,
    maxVal: displayMax,
    valRange: displayMax - displayMin || 1e-3,
    targetMin,
    targetMax,
    displayMin,
    displayMax,
    rangeInited: true
  };
}
function updateHoverState(hoverPixelX, pad, w, layout, now, visible, scrubAmount, lastHover, cfg, noMotion, leftEdge, rightEdge, chartW, dt) {
  let hoverValue = null;
  let hoverTime = null;
  let hoverChartX = null;
  let isActiveHover = false;
  if (hoverPixelX !== null && hoverPixelX >= pad.left && hoverPixelX <= w - pad.right) {
    const maxHoverX = layout.toX(now);
    const clampedX = Math.min(hoverPixelX, maxHoverX);
    const t = leftEdge + (clampedX - pad.left) / chartW * (rightEdge - leftEdge);
    const v = interpolateAtTime(visible, t);
    if (v !== null) {
      hoverValue = v;
      hoverTime = t;
      hoverChartX = clampedX;
      isActiveHover = true;
      lastHover = { x: clampedX, value: v, time: t };
      cfg.onHover?.({ time: t, value: v, x: clampedX, y: layout.toY(v) });
    }
  }
  const scrubTarget = isActiveHover ? 1 : 0;
  if (noMotion) {
    scrubAmount = scrubTarget;
  } else {
    scrubAmount += (scrubTarget - scrubAmount) * SCRUB_LERP_SPEED;
    if (scrubAmount < 0.01) scrubAmount = 0;
    if (scrubAmount > 0.99) scrubAmount = 1;
  }
  let drawHoverX = hoverChartX;
  let drawHoverValue = hoverValue;
  let drawHoverTime = hoverTime;
  if (!isActiveHover && scrubAmount > 0 && lastHover) {
    drawHoverX = lastHover.x;
    drawHoverValue = lastHover.value;
    drawHoverTime = lastHover.time;
  }
  return {
    hoverX: drawHoverX,
    hoverValue: drawHoverValue,
    hoverTime: drawHoverTime,
    scrubAmount,
    isActiveHover,
    lastHover
  };
}
function updateBadgeDOM(badge, cfg, smoothValue, layout, momentum, badgeY, badgeColor, isWindowTransitioning, noMotion, ctx, dt, chartReveal = 1) {
  if (!cfg.showBadge || chartReveal < 0.25) {
    badge.container.style.display = "none";
    return badgeY;
  }
  badge.container.style.display = "";
  const badgeOpacity = chartReveal < 0.5 ? (chartReveal - 0.25) / 0.25 : 1;
  badge.container.style.opacity = badgeOpacity < 1 ? String(badgeOpacity) : "";
  const { w, h, pad } = layout;
  const text = cfg.formatValue(smoothValue);
  badge.text.textContent = text;
  badge.text.style.font = cfg.palette.labelFont;
  badge.text.style.lineHeight = `${BADGE_LINE_H}px`;
  const tailLen = cfg.badgeTail ? BADGE_TAIL_LEN : 0;
  badge.text.style.padding = `${BADGE_PAD_Y}px ${BADGE_PAD_X}px ${BADGE_PAD_Y}px ${tailLen + BADGE_PAD_X}px`;
  ctx.font = cfg.palette.labelFont;
  const template = text.replace(/[0-9]/g, "8");
  const targetTextW = ctx.measureText(template).width;
  badge.targetW = targetTextW;
  if (badge.displayW === 0) badge.displayW = targetTextW;
  badge.displayW = lerp(badge.displayW, badge.targetW, BADGE_WIDTH_LERP, dt);
  if (Math.abs(badge.displayW - badge.targetW) < 0.3) badge.displayW = badge.targetW;
  const textW = badge.displayW;
  const pillW = textW + BADGE_PAD_X * 2;
  const pillH = BADGE_LINE_H + BADGE_PAD_Y * 2;
  const totalW = tailLen + pillW;
  badge.svg.setAttribute("width", String(Math.ceil(totalW)));
  badge.svg.setAttribute("height", String(pillH));
  badge.svg.setAttribute("viewBox", `0 0 ${totalW} ${pillH}`);
  badge.path.setAttribute("d", cfg.badgeTail ? badgeSvgPath(pillW, pillH, BADGE_TAIL_LEN, BADGE_TAIL_SPREAD) : badgePillOnly(pillW, pillH));
  const centerY = pad.top + layout.chartH / 2;
  const realTargetY = Math.max(pad.top, Math.min(h - pad.bottom, layout.toY(smoothValue)));
  const targetBadgeY = chartReveal < 1 ? centerY + (realTargetY - centerY) * chartReveal : realTargetY;
  if (badgeY === null || noMotion) {
    badgeY = targetBadgeY;
  } else {
    const badgeSpeed = isWindowTransitioning ? BADGE_Y_LERP_TRANSITIONING : BADGE_Y_LERP;
    badgeY = lerp(badgeY, targetBadgeY, badgeSpeed, dt);
  }
  const badgeLeft = w - pad.right + 8 - BADGE_PAD_X - tailLen;
  const badgeTop = badgeY - pillH / 2;
  badge.container.style.transform = `translate3d(${badgeLeft}px, ${badgeTop}px, 0)`;
  if (cfg.badgeVariant === "minimal") {
    badge.path.setAttribute("fill", cfg.palette.badgeOuterBg);
    badge.text.style.color = cfg.palette.tooltipText;
    badge.container.style.filter = `drop-shadow(0 1px 4px ${cfg.palette.badgeOuterShadow})`;
  } else {
    badge.container.style.filter = "";
    badge.text.style.color = "#fff";
    const bs = badgeColor;
    let fillColor;
    if (!cfg.showMomentum) {
      fillColor = cfg.palette.line;
    } else {
      const target = momentum === "up" ? 1 : momentum === "down" ? 0 : bs.green;
      bs.green = noMotion ? target : lerp(bs.green, target, MOMENTUM_COLOR_LERP, dt);
      if (bs.green > 0.99) bs.green = 1;
      if (bs.green < 0.01) bs.green = 0;
      const g = bs.green;
      const rr = Math.round(MOMENTUM_RED[0] + (MOMENTUM_GREEN[0] - MOMENTUM_RED[0]) * g);
      const gg = Math.round(MOMENTUM_RED[1] + (MOMENTUM_GREEN[1] - MOMENTUM_RED[1]) * g);
      const bb = Math.round(MOMENTUM_RED[2] + (MOMENTUM_GREEN[2] - MOMENTUM_RED[2]) * g);
      fillColor = `rgb(${rr},${gg},${bb})`;
    }
    badge.path.setAttribute("fill", fillColor);
  }
  return badgeY;
}
function computeCandleRange(candles) {
  let min = Infinity;
  let max = -Infinity;
  for (const c of candles) {
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
  }
  if (!isFinite(min) || !isFinite(max)) return { min: 99, max: 101 };
  const range = max - min;
  const margin = range * 0.12;
  const minRange = range * 0.1 || 0.4;
  if (range < minRange) {
    const mid = (min + max) / 2;
    return { min: mid - minRange / 2, max: mid + minRange / 2 };
  }
  return { min: min - margin, max: max + margin };
}
function candleAtX(candles, hoverX, candleWidth, layout) {
  const time = layout.leftEdge + (hoverX - layout.pad.left) / layout.chartW * (layout.rightEdge - layout.leftEdge);
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    const c = candles[mid];
    if (time < c.time) hi = mid - 1;
    else if (time >= c.time + candleWidth) lo = mid + 1;
    else return c;
  }
  return null;
}
function updateCandleRange(computedRange, rangeInited, displayMin, displayMax, isTransitioning, windowTransProgress, wt, chartH, dt) {
  if (!rangeInited) {
    return {
      minVal: computedRange.min,
      maxVal: computedRange.max,
      valRange: computedRange.max - computedRange.min || 1e-3,
      displayMin: computedRange.min,
      displayMax: computedRange.max,
      rangeInited: true
    };
  }
  if (isTransitioning) {
    displayMin = wt.rangeFromMin + (wt.rangeToMin - wt.rangeFromMin) * windowTransProgress;
    displayMax = wt.rangeFromMax + (wt.rangeToMax - wt.rangeFromMax) * windowTransProgress;
  } else {
    const curRange = displayMax - displayMin || 1;
    const gapMin = Math.abs(displayMin - computedRange.min);
    const gapMax = Math.abs(displayMax - computedRange.max);
    const gapRatio = Math.min((gapMin + gapMax) / curRange, 1);
    const speed = RANGE_LERP_SPEED + (1 - gapRatio) * RANGE_ADAPTIVE_BOOST;
    displayMin = lerp(displayMin, computedRange.min, speed, dt);
    displayMax = lerp(displayMax, computedRange.max, speed, dt);
    const pxThreshold = 0.5 * curRange / chartH || 1e-3;
    if (Math.abs(displayMin - computedRange.min) < pxThreshold) displayMin = computedRange.min;
    if (Math.abs(displayMax - computedRange.max) < pxThreshold) displayMax = computedRange.max;
  }
  return {
    minVal: displayMin,
    maxVal: displayMax,
    valRange: displayMax - displayMin || 1e-3,
    displayMin,
    displayMax,
    rangeInited: true
  };
}
function updateCandleWindowTransition(targetWindowSecs, wt, displayWindow, displayMin, displayMax, now_ms, now, candles, liveCandle, candleWidth, buffer) {
  if (wt.to !== targetWindowSecs) {
    wt.from = displayWindow;
    wt.to = targetWindowSecs;
    wt.startMs = now_ms;
    wt.rangeFromMin = displayMin;
    wt.rangeFromMax = displayMax;
    const targetRightEdge = now + targetWindowSecs * buffer;
    const targetLeftEdge = targetRightEdge - targetWindowSecs;
    const targetVisible = [];
    for (const c of candles) {
      if (c.time + candleWidth >= targetLeftEdge && c.time <= targetRightEdge) {
        targetVisible.push(c);
      }
    }
    if (liveCandle && liveCandle.time + candleWidth >= targetLeftEdge && liveCandle.time <= targetRightEdge) {
      targetVisible.push(liveCandle);
    }
    if (targetVisible.length > 0) {
      const tr = computeCandleRange(targetVisible);
      wt.rangeToMin = tr.min;
      wt.rangeToMax = tr.max;
    }
  }
  let windowTransProgress = 0;
  let resultWindow;
  if (wt.startMs === 0) {
    resultWindow = targetWindowSecs;
  } else {
    const elapsed = now_ms - wt.startMs;
    const t = Math.min(elapsed / WINDOW_TRANSITION_MS, 1);
    const eased = (1 - Math.cos(t * Math.PI)) / 2;
    windowTransProgress = eased;
    const logFrom = Math.log(wt.from);
    const logTo = Math.log(wt.to);
    resultWindow = Math.exp(logFrom + (logTo - logFrom) * eased);
    if (t >= 1) {
      resultWindow = targetWindowSecs;
      wt.startMs = 0;
      windowTransProgress = 0;
    }
  }
  return { windowSecs: resultWindow, windowTransProgress };
}
function useLivelineEngine(canvasRef, containerRef, config) {
  const configRef = useRef(config);
  configRef.current = config;
  const displayValueRef = useRef(config.value);
  const displayMinRef = useRef(0);
  const displayMaxRef = useRef(0);
  const targetMinRef = useRef(0);
  const targetMaxRef = useRef(0);
  const rangeInitedRef = useRef(false);
  const displayWindowRef = useRef(config.windowSecs);
  const windowTransitionRef = useRef({
    from: config.windowSecs,
    to: config.windowSecs,
    startMs: 0,
    rangeFromMin: 0,
    rangeFromMax: 0,
    rangeToMin: 0,
    rangeToMax: 0
  });
  const arrowStateRef = useRef({ up: 0, down: 0 });
  const gridStateRef = useRef({ interval: 0, labels: /* @__PURE__ */ new Map() });
  const timeAxisStateRef = useRef({ labels: /* @__PURE__ */ new Map() });
  const orderbookStateRef = useRef(createOrderbookState());
  const particleStateRef = useRef(createParticleState());
  const shakeStateRef = useRef(createShakeState());
  const badgeColorRef = useRef({ green: 1 });
  const badgeYRef = useRef(null);
  const reducedMotionRef = useRef(false);
  const sizeRef = useRef({ w: 0, h: 0 });
  const ctxRef = useRef(null);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const badgeRef = useRef(null);
  const hoverXRef = useRef(null);
  const scrubAmountRef = useRef(0);
  const lastHoverRef = useRef(null);
  const chartRevealRef = useRef(0);
  const pauseProgressRef = useRef(0);
  const timeDebtRef = useRef(0);
  const lastDataRef = useRef([]);
  const frozenNowRef = useRef(0);
  const pausedDataRef = useRef(null);
  const loadingAlphaRef = useRef(config.loading ? 1 : 0);
  const displayCandleRef = useRef(null);
  const liveBirthAlphaRef = useRef(1);
  const liveBullRef = useRef(0.5);
  const lineSmoothCloseRef = useRef(0);
  const lineSmoothInitedRef = useRef(false);
  const closeLineSmoothRef = useRef(0);
  const closeLineSmoothInitedRef = useRef(false);
  const lineModeProgRef = useRef(0);
  const lineModeTransRef = useRef({ startMs: 0, from: 0, to: 0 });
  const lineDensityProgRef = useRef(0);
  const lineDensityTransRef = useRef({ startMs: 0, from: 0, to: 0 });
  const lineTickSmoothRef = useRef(0);
  const lineTickSmoothInitedRef = useRef(false);
  const candleWidthTransRef = useRef({
    fromWidth: config.candleWidth ?? 1,
    toWidth: config.candleWidth ?? 1,
    startMs: 0,
    rangeFromMin: 0,
    rangeFromMax: 0,
    rangeToMin: 0,
    rangeToMax: 0,
    oldCandles: [],
    oldWidth: config.candleWidth ?? 1
  });
  const prevCandleDataRef = useRef({ candles: [], width: config.candleWidth ?? 1 });
  const pausedCandlesRef = useRef(null);
  const pausedLiveRef = useRef(null);
  const pausedLineDataRef = useRef(null);
  const pausedLineValueRef = useRef(null);
  const lastCandlesRef = useRef([]);
  const lastLiveRef = useRef(null);
  const lastLineDataStashRef = useRef([]);
  const lastLineValueStashRef = useRef(void 0);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;will-change:transform;display:none;z-index:1;";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.style.cssText = "position:absolute;top:0;left:0;";
    const path = document.createElementNS(SVG_NS, "path");
    svg.appendChild(path);
    const text = document.createElement("span");
    text.style.cssText = "position:relative;display:block;color:#fff;white-space:nowrap;";
    el.appendChild(svg);
    el.appendChild(text);
    container.appendChild(el);
    badgeRef.current = { container: el, svg, path, text, displayW: 0, targetW: 0 };
    return () => {
      container.removeChild(el);
      badgeRef.current = null;
    };
  }, [containerRef]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      sizeRef.current = { w: width, h: height };
    });
    ro.observe(container);
    const rect = container.getBoundingClientRect();
    sizeRef.current = { w: rect.width, h: rect.height };
    return () => ro.disconnect();
  }, [containerRef]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onMove = (e) => {
      if (!configRef.current.scrub) return;
      const rect = container.getBoundingClientRect();
      hoverXRef.current = e.clientX - rect.left;
    };
    const onLeave = () => {
      hoverXRef.current = null;
      configRef.current.onHover?.(null);
    };
    const onTouchStart = (e) => {
      if (!configRef.current.scrub) return;
      if (e.touches.length !== 1) return;
      const rect = container.getBoundingClientRect();
      hoverXRef.current = e.touches[0].clientX - rect.left;
    };
    const onTouchMove = (e) => {
      if (!configRef.current.scrub) return;
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      hoverXRef.current = e.touches[0].clientX - rect.left;
    };
    const onTouchEnd = () => {
      hoverXRef.current = null;
      configRef.current.onHover?.(null);
    };
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd);
    container.addEventListener("touchcancel", onTouchEnd);
    return () => {
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [containerRef]);
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = mql.matches;
    const onChange = (e) => {
      reducedMotionRef.current = e.matches;
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden && !rafRef.current) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const draw = useCallback(() => {
    if (document.hidden) {
      rafRef.current = 0;
      return;
    }
    const canvas = canvasRef.current;
    const { w, h } = sizeRef.current;
    if (!canvas || w === 0 || h === 0) {
      rafRef.current = requestAnimationFrame(draw);
      return;
    }
    const cfg = configRef.current;
    const dpr = getDpr();
    const now_ms = performance.now();
    const dt = lastFrameRef.current ? Math.min(now_ms - lastFrameRef.current, MAX_DELTA_MS) : 16.67;
    lastFrameRef.current = now_ms;
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    let ctx = ctxRef.current;
    if (!ctx || ctx.canvas !== canvas) {
      ctx = canvas.getContext("2d");
      ctxRef.current = ctx;
    }
    if (!ctx) {
      rafRef.current = requestAnimationFrame(draw);
      return;
    }
    applyDpr(ctx, dpr, w, h);
    const noMotion = reducedMotionRef.current;
    const isCandle = cfg.mode === "candle";
    if (isCandle) {
      if (cfg.paused && pausedCandlesRef.current === null && (cfg.candles?.length ?? 0) > 0) {
        pausedCandlesRef.current = cfg.candles.slice();
        pausedLiveRef.current = cfg.liveCandle ?? null;
        pausedLineDataRef.current = cfg.lineData?.slice() ?? null;
        pausedLineValueRef.current = cfg.lineValue ?? null;
      }
      if (!cfg.paused) {
        pausedCandlesRef.current = null;
        pausedLiveRef.current = null;
        pausedLineDataRef.current = null;
        pausedLineValueRef.current = null;
      }
    } else {
      if (cfg.paused && pausedDataRef.current === null && cfg.data.length >= 2) {
        pausedDataRef.current = cfg.data.slice();
      }
      if (!cfg.paused) {
        pausedDataRef.current = null;
      }
    }
    const points = isCandle ? [] : pausedDataRef.current ?? cfg.data;
    const effectiveCandles = isCandle ? pausedCandlesRef.current ?? (cfg.candles ?? []) : [];
    const hasData = isCandle ? effectiveCandles.length >= 2 : points.length >= 2;
    const pad = cfg.padding;
    const chartH = h - pad.top - pad.bottom;
    const pauseTarget = cfg.paused ? 1 : 0;
    pauseProgressRef.current = noMotion ? pauseTarget : lerp(pauseProgressRef.current, pauseTarget, PAUSE_PROGRESS_SPEED, dt);
    if (pauseProgressRef.current < 5e-3) pauseProgressRef.current = 0;
    if (pauseProgressRef.current > 0.995) pauseProgressRef.current = 1;
    const pauseProgress = pauseProgressRef.current;
    const pausedDt = dt * (1 - pauseProgress);
    const realDtSec = dt / 1e3;
    timeDebtRef.current += realDtSec * pauseProgress;
    if (!cfg.paused && timeDebtRef.current > 1e-3) {
      const catchUpSpeed = timeDebtRef.current > 10 ? PAUSE_CATCHUP_SPEED_FAST : PAUSE_CATCHUP_SPEED;
      timeDebtRef.current = lerp(timeDebtRef.current, 0, catchUpSpeed, dt);
      if (timeDebtRef.current < 0.01) timeDebtRef.current = 0;
    }
    const loadingTarget = cfg.loading ? 1 : 0;
    loadingAlphaRef.current = noMotion ? loadingTarget : lerp(loadingAlphaRef.current, loadingTarget, LOADING_ALPHA_SPEED, dt);
    if (loadingAlphaRef.current < 0.01) loadingAlphaRef.current = 0;
    if (loadingAlphaRef.current > 0.99) loadingAlphaRef.current = 1;
    const loadingAlpha = loadingAlphaRef.current;
    const revealTarget = !cfg.loading && hasData ? 1 : 0;
    chartRevealRef.current = noMotion ? revealTarget : lerp(
      chartRevealRef.current,
      revealTarget,
      revealTarget === 1 ? CHART_REVEAL_SPEED_FWD : CHART_REVEAL_SPEED,
      dt
    );
    if (Math.abs(chartRevealRef.current - revealTarget) < 5e-3) {
      chartRevealRef.current = revealTarget;
    }
    const chartReveal = chartRevealRef.current;
    if (chartReveal < 0.01) {
      rangeInitedRef.current = false;
    }
    let useStash;
    if (isCandle) {
      useStash = !hasData && chartReveal > 5e-3 && lastCandlesRef.current.length > 0;
    } else {
      useStash = !hasData && chartReveal > 5e-3 && lastDataRef.current.length >= 2;
      if (hasData) lastDataRef.current = points;
    }
    if (isCandle) {
      const lmt = lineModeTransRef.current;
      const lineModeTarget = cfg.lineMode ? 1 : 0;
      if (lmt.to !== lineModeTarget) {
        lmt.from = lineModeProgRef.current;
        lmt.to = lineModeTarget;
        lmt.startMs = now_ms;
      }
      if (lmt.startMs > 0) {
        const elapsed = now_ms - lmt.startMs;
        const t = Math.min(elapsed / LINE_MORPH_MS, 1);
        lineModeProgRef.current = lmt.from + (lmt.to - lmt.from) * ((1 - Math.cos(t * Math.PI)) / 2);
        if (t >= 1) {
          lineModeProgRef.current = lmt.to;
          lmt.startMs = 0;
        }
      } else {
        lineModeProgRef.current = lmt.to;
      }
    }
    if (!hasData && !useStash) {
      const loadingColor = isCandle ? cfg.palette.gridLabel : void 0;
      if (loadingAlpha > 0.01) {
        drawLoading(ctx, w, h, pad, cfg.palette, now_ms, loadingAlpha, loadingColor);
      }
      if (1 - loadingAlpha > 0.01) {
        drawEmpty(ctx, w, h, pad, cfg.palette, 1 - loadingAlpha, now_ms, false, cfg.emptyText);
      }
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      const fadeGrad = ctx.createLinearGradient(pad.left, 0, pad.left + FADE_EDGE_WIDTH, 0);
      fadeGrad.addColorStop(0, "rgba(0, 0, 0, 1)");
      fadeGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = fadeGrad;
      ctx.fillRect(0, 0, pad.left + FADE_EDGE_WIDTH, h);
      ctx.restore();
      if (badgeRef.current) badgeRef.current.container.style.display = "none";
      rafRef.current = requestAnimationFrame(draw);
      return;
    }
    if (isCandle) {
      if (hasData) frozenNowRef.current = Date.now() / 1e3 - timeDebtRef.current;
      const now = hasData || chartReveal < 5e-3 ? Date.now() / 1e3 - timeDebtRef.current : frozenNowRef.current;
      const rawLive = pausedCandlesRef.current ? pausedLiveRef.current ?? void 0 : cfg.liveCandle;
      let effectiveLineData = pausedLineDataRef.current ?? cfg.lineData;
      let effectiveLineValue = pausedLineValueRef.current ?? cfg.lineValue;
      if (hasData && effectiveLineData && effectiveLineData.length > 0) {
        lastLineDataStashRef.current = effectiveLineData;
        lastLineValueStashRef.current = effectiveLineValue;
      }
      if (useStash && lastLineDataStashRef.current.length > 0) {
        effectiveLineData = lastLineDataStashRef.current;
        effectiveLineValue = lastLineValueStashRef.current;
      }
      const candleWidthSecs = cfg.candleWidth ?? 1;
      const cwt = candleWidthTransRef.current;
      let morphT = -1;
      let displayCandleWidth;
      if (cwt.startMs > 0) {
        const elapsed = now_ms - cwt.startMs;
        const t = Math.min(elapsed / CANDLE_WIDTH_TRANS_MS, 1);
        morphT = (1 - Math.cos(t * Math.PI)) / 2;
        displayCandleWidth = Math.exp(
          Math.log(cwt.fromWidth) + (Math.log(cwt.toWidth) - Math.log(cwt.fromWidth)) * morphT
        );
        if (t >= 1) {
          displayCandleWidth = cwt.toWidth;
          cwt.startMs = 0;
          morphT = -1;
        }
      } else {
        displayCandleWidth = cwt.toWidth;
      }
      if (candleWidthSecs !== cwt.toWidth) {
        cwt.oldCandles = prevCandleDataRef.current.candles;
        cwt.oldWidth = prevCandleDataRef.current.width;
        cwt.fromWidth = displayCandleWidth;
        cwt.toWidth = candleWidthSecs;
        cwt.startMs = now_ms;
        morphT = 0;
        cwt.rangeFromMin = displayMinRef.current;
        cwt.rangeFromMax = displayMaxRef.current;
        const curWindow = displayWindowRef.current;
        const re = now + curWindow * CANDLE_BUFFER;
        const le = re - curWindow;
        const targetVis = [];
        for (const c of effectiveCandles) {
          if (c.time + candleWidthSecs >= le && c.time <= re) targetVis.push(c);
        }
        if (rawLive) targetVis.push(rawLive);
        if (targetVis.length > 0) {
          const tr = computeCandleRange(targetVis);
          cwt.rangeToMin = tr.min;
          cwt.rangeToMax = tr.max;
        } else {
          cwt.rangeToMin = displayMinRef.current;
          cwt.rangeToMax = displayMaxRef.current;
        }
      }
      prevCandleDataRef.current = { candles: cfg.candles ?? [], width: candleWidthSecs };
      const lineModeProg = lineModeProgRef.current;
      const ldt = lineDensityTransRef.current;
      const hasTickData = effectiveLineData && effectiveLineData.length > 0;
      const densityTarget = cfg.lineMode && lineModeProg >= 0.3 && hasTickData ? 1 : 0;
      if (ldt.to !== densityTarget) {
        ldt.from = lineDensityProgRef.current;
        ldt.to = densityTarget;
        ldt.startMs = now_ms;
      }
      let lineDensityProg;
      if (ldt.startMs > 0) {
        const elapsed = now_ms - ldt.startMs;
        const t = Math.min(elapsed / LINE_DENSITY_MS, 1);
        lineDensityProg = ldt.from + (ldt.to - ldt.from) * (1 - (1 - t) * (1 - t));
        if (t >= 1) {
          lineDensityProg = ldt.to;
          ldt.startMs = 0;
        }
      } else {
        lineDensityProg = ldt.to;
      }
      lineDensityProgRef.current = lineDensityProg;
      const transition = windowTransitionRef.current;
      const windowResult = updateCandleWindowTransition(
        cfg.windowSecs,
        transition,
        displayWindowRef.current,
        displayMinRef.current,
        displayMaxRef.current,
        now_ms,
        now,
        effectiveCandles,
        rawLive,
        candleWidthSecs,
        CANDLE_BUFFER
      );
      displayWindowRef.current = windowResult.windowSecs;
      const windowSecs = windowResult.windowSecs;
      const windowTransProgress = windowResult.windowTransProgress;
      const isWindowTransitioning = transition.startMs > 0;
      const rightEdge = now + windowSecs * CANDLE_BUFFER;
      const leftEdge = rightEdge - windowSecs;
      let smoothLive;
      if (rawLive) {
        const prev = displayCandleRef.current;
        if (!prev || prev.time !== rawLive.time) {
          displayCandleRef.current = {
            time: rawLive.time,
            open: rawLive.open,
            high: rawLive.open,
            low: rawLive.open,
            close: rawLive.open
          };
          liveBirthAlphaRef.current = 0;
        } else {
          const dc2 = displayCandleRef.current;
          dc2.open = lerp(dc2.open, rawLive.open, CANDLE_LERP_SPEED, pausedDt);
          dc2.high = lerp(dc2.high, rawLive.high, CANDLE_LERP_SPEED, pausedDt);
          dc2.low = lerp(dc2.low, rawLive.low, CANDLE_LERP_SPEED, pausedDt);
          dc2.close = lerp(dc2.close, rawLive.close, CANDLE_LERP_SPEED, pausedDt);
        }
        liveBirthAlphaRef.current = lerp(liveBirthAlphaRef.current, 1, 0.2, pausedDt);
        if (liveBirthAlphaRef.current > 0.99) liveBirthAlphaRef.current = 1;
        const dc = displayCandleRef.current;
        const bullTarget = dc.close >= dc.open ? 1 : 0;
        liveBullRef.current = lerp(liveBullRef.current, bullTarget, 0.12, pausedDt);
        if (liveBullRef.current > 0.99) liveBullRef.current = 1;
        if (liveBullRef.current < 0.01) liveBullRef.current = 0;
        smoothLive = dc;
      } else {
        displayCandleRef.current = null;
        liveBirthAlphaRef.current = 1;
        liveBullRef.current = 0.5;
      }
      if (rawLive) {
        if (!closeLineSmoothInitedRef.current) {
          closeLineSmoothRef.current = rawLive.close;
          closeLineSmoothInitedRef.current = true;
        } else {
          closeLineSmoothRef.current = lerp(closeLineSmoothRef.current, rawLive.close, CLOSE_LINE_LERP_SPEED, pausedDt);
          const gap = Math.abs(closeLineSmoothRef.current - rawLive.close);
          const range = displayMaxRef.current - displayMinRef.current || 1;
          if (gap < range * 5e-4) closeLineSmoothRef.current = rawLive.close;
        }
      } else if (!useStash) {
        closeLineSmoothInitedRef.current = false;
      }
      if (rawLive) {
        if (!lineSmoothInitedRef.current) {
          lineSmoothCloseRef.current = rawLive.close;
          lineSmoothInitedRef.current = true;
        } else {
          const valGap = Math.abs(rawLive.close - lineSmoothCloseRef.current);
          const prevRange = displayMaxRef.current - displayMinRef.current || 1;
          const gapRatio = Math.min(valGap / prevRange, 1);
          const adaptiveSpeed = LINE_LERP_BASE + (1 - gapRatio) * LINE_ADAPTIVE_BOOST;
          lineSmoothCloseRef.current = lerp(lineSmoothCloseRef.current, rawLive.close, adaptiveSpeed, pausedDt);
          if (valGap < prevRange * LINE_SNAP_THRESHOLD) lineSmoothCloseRef.current = rawLive.close;
        }
      } else if (!useStash) {
        lineSmoothInitedRef.current = false;
      }
      if (effectiveLineValue !== void 0 && hasTickData) {
        if (!lineTickSmoothInitedRef.current) {
          lineTickSmoothRef.current = effectiveLineValue;
          lineTickSmoothInitedRef.current = true;
        } else {
          const valGap = Math.abs(effectiveLineValue - lineTickSmoothRef.current);
          const prevRange = displayMaxRef.current - displayMinRef.current || 1;
          const gapRatio = Math.min(valGap / prevRange, 1);
          const adaptiveSpeed = LINE_LERP_BASE + (1 - gapRatio) * LINE_ADAPTIVE_BOOST;
          lineTickSmoothRef.current = lerp(lineTickSmoothRef.current, effectiveLineValue, adaptiveSpeed, pausedDt);
          if (valGap < prevRange * LINE_SNAP_THRESHOLD) lineTickSmoothRef.current = effectiveLineValue;
        }
      } else if (!useStash) {
        lineTickSmoothInitedRef.current = false;
      }
      const visible = [];
      for (const c of effectiveCandles) {
        if (c.time + candleWidthSecs >= leftEdge && c.time <= rightEdge) visible.push(c);
      }
      if (smoothLive && smoothLive.time + displayCandleWidth >= leftEdge && smoothLive.time <= rightEdge) {
        visible.push(smoothLive);
      }
      let oldVisible = [];
      if (morphT >= 0 && cwt.oldCandles.length > 0) {
        for (const c of cwt.oldCandles) {
          if (c.time + cwt.oldWidth >= leftEdge && c.time <= rightEdge) oldVisible.push(c);
        }
      }
      if (hasData) {
        lastCandlesRef.current = visible;
        lastLiveRef.current = smoothLive ?? null;
      }
      const effectiveVisible = useStash ? lastCandlesRef.current : visible;
      const effectiveLive = useStash ? lastLiveRef.current ?? void 0 : smoothLive;
      const chartW = w - pad.left - pad.right;
      const computed = effectiveVisible.length > 0 ? computeCandleRange(effectiveVisible) : { min: displayMinRef.current, max: displayMaxRef.current };
      const rangeResult = updateCandleRange(
        computed,
        rangeInitedRef.current,
        displayMinRef.current,
        displayMaxRef.current,
        isWindowTransitioning,
        windowTransProgress,
        transition,
        chartH,
        pausedDt
      );
      if (morphT >= 0) {
        rangeResult.displayMin = cwt.rangeFromMin + (cwt.rangeToMin - cwt.rangeFromMin) * morphT;
        rangeResult.displayMax = cwt.rangeFromMax + (cwt.rangeToMax - cwt.rangeFromMax) * morphT;
        rangeResult.minVal = rangeResult.displayMin;
        rangeResult.maxVal = rangeResult.displayMax;
        rangeResult.valRange = rangeResult.displayMax - rangeResult.displayMin || 1e-3;
      }
      rangeInitedRef.current = rangeResult.rangeInited;
      displayMinRef.current = rangeResult.displayMin;
      displayMaxRef.current = rangeResult.displayMax;
      const { minVal, maxVal, valRange } = rangeResult;
      const layout = {
        w,
        h,
        pad,
        chartW,
        chartH,
        leftEdge,
        rightEdge,
        minVal,
        maxVal,
        valRange,
        toX: (t) => pad.left + (t - leftEdge) / (rightEdge - leftEdge) * chartW,
        toY: (v) => pad.top + (1 - (v - minVal) / valRange) * chartH
      };
      const hoverPx = hoverXRef.current;
      let hoveredCandle = null;
      let isActiveHover = false;
      if (hoverPx !== null && hoverPx >= pad.left && hoverPx <= w - pad.right) {
        hoveredCandle = candleAtX(effectiveVisible, hoverPx, displayCandleWidth, layout);
        if (hoveredCandle) isActiveHover = true;
      }
      const scrubTarget = isActiveHover ? 1 : 0;
      scrubAmountRef.current = lerp(scrubAmountRef.current, scrubTarget, 0.12, dt);
      if (scrubAmountRef.current < 0.01) scrubAmountRef.current = 0;
      if (scrubAmountRef.current > 0.99) scrubAmountRef.current = 1;
      const scrubAmount = scrubAmountRef.current;
      let drawHoverX = hoverPx;
      let drawHoverTime = 0;
      let drawHoverCandle = hoveredCandle;
      if (!isActiveHover && scrubAmount > 0 && lastHoverRef.current) {
        drawHoverX = lastHoverRef.current.x;
        drawHoverTime = lastHoverRef.current.time;
        drawHoverCandle = candleAtX(effectiveVisible, lastHoverRef.current.x, displayCandleWidth, layout);
      } else if (isActiveHover && hoverPx !== null) {
        drawHoverTime = layout.leftEdge + (hoverPx - pad.left) / chartW * (layout.rightEdge - layout.leftEdge);
        lastHoverRef.current = { x: hoverPx, value: hoveredCandle?.close ?? 0, time: drawHoverTime };
      }
      let drawCandles = effectiveVisible;
      let drawOldCandles = oldVisible;
      let drawLive = effectiveLive;
      if (lineModeProg > 0.01 && drawLive && lineSmoothInitedRef.current) {
        const blended = drawLive.close + (lineSmoothCloseRef.current - drawLive.close) * lineModeProg;
        drawLive = { ...drawLive, close: blended };
        const li = drawCandles.length - 1;
        if (li >= 0 && drawCandles[li].time === drawLive.time) {
          drawCandles = drawCandles.slice();
          drawCandles[li] = { ...drawCandles[li], close: blended };
        }
      }
      if (lineModeProg > 0.01 && lineModeProg < 0.99) {
        const collapseOHLC = (c) => {
          const inv = 1 - lineModeProg;
          return {
            time: c.time,
            open: c.close + (c.open - c.close) * inv,
            high: c.close + (c.high - c.close) * inv,
            low: c.close + (c.low - c.close) * inv,
            close: c.close
          };
        };
        drawCandles = drawCandles.map(collapseOHLC);
        if (drawOldCandles.length > 0) drawOldCandles = drawOldCandles.map(collapseOHLC);
        if (drawLive) drawLive = collapseOHLC(drawLive);
      }
      let lineVisible;
      let lineSmoothValue;
      if (effectiveLineData && effectiveLineData.length > 0 && (lineDensityProg > 0.01 || lineModeProg > 0.05)) {
        const closeRefs = [];
        for (const c of drawCandles) {
          closeRefs.push({ t: c.time + displayCandleWidth / 2, v: c.close });
        }
        if (drawLive) closeRefs.push({ t: now, v: drawLive.close });
        lineVisible = [];
        let refIdx = 0;
        for (const pt of effectiveLineData) {
          if (pt.time < leftEdge || pt.time > rightEdge) continue;
          while (refIdx < closeRefs.length - 2 && closeRefs[refIdx + 1].t < pt.time) refIdx++;
          let interpClose;
          if (closeRefs.length === 0) {
            interpClose = pt.value;
          } else if (closeRefs.length === 1 || pt.time <= closeRefs[0].t) {
            interpClose = closeRefs[0].v;
          } else if (refIdx >= closeRefs.length - 1) {
            interpClose = closeRefs[closeRefs.length - 1].v;
          } else {
            const a = closeRefs[refIdx];
            const b = closeRefs[refIdx + 1];
            const span = b.t - a.t;
            const frac = span > 0 ? Math.max(0, Math.min(1, (pt.time - a.t) / span)) : 0;
            interpClose = a.v + (b.v - a.v) * frac;
          }
          const blended = interpClose + (pt.value - interpClose) * lineDensityProg;
          lineVisible.push({ time: pt.time, value: blended });
        }
        const smoothTick = lineTickSmoothInitedRef.current ? lineTickSmoothRef.current : effectiveLineValue ?? effectiveLineData[effectiveLineData.length - 1].value;
        lineSmoothValue = lineSmoothCloseRef.current + (smoothTick - lineSmoothCloseRef.current) * lineDensityProg;
      } else {
        lineVisible = drawCandles.map((c) => ({
          time: c.time + displayCandleWidth / 2,
          value: c.close
        }));
        lineSmoothValue = lineSmoothInitedRef.current ? lineSmoothCloseRef.current : drawLive?.close ?? drawCandles[drawCandles.length - 1]?.close ?? 0;
      }
      if (chartReveal < 1 && lineVisible.length >= 2) {
        const firstTime = lineVisible[0].time;
        const windowSpan = rightEdge - leftEdge;
        if (firstTime - leftEdge > windowSpan * 0.05) {
          const firstVal = lineVisible[0].value;
          const step = windowSpan / 32;
          const padded = [];
          for (let t = leftEdge; t < firstTime - step * 0.5; t += step) {
            padded.push({ time: t, value: firstVal });
          }
          lineVisible = [...padded, ...lineVisible];
        }
      }
      drawCandleFrame(ctx, layout, cfg.palette, {
        candles: drawCandles,
        displayCandleWidth,
        oldCandles: drawOldCandles,
        oldWidth: cwt.oldWidth,
        morphT,
        liveCandle: drawLive,
        closePriceCandle: closeLineSmoothInitedRef.current && rawLive ? { ...rawLive, close: closeLineSmoothRef.current } : rawLive,
        bullColor: cfg.bullColor,
        bearColor: cfg.bearColor,
        liveTime: effectiveLive?.time ?? -1,
        liveBirthAlpha: liveBirthAlphaRef.current,
        liveBullBlend: liveBullRef.current,
        lineModeProg,
        chartReveal,
        now_ms,
        now,
        pauseProgress,
        showGrid: cfg.showGrid,
        scrubAmount,
        hoverX: drawHoverX,
        hoverValue: drawHoverCandle?.close ?? null,
        hoverTime: drawHoverTime,
        hoveredCandle: drawHoverCandle,
        formatValue: cfg.formatValue,
        formatTime: cfg.formatTime,
        gridState: gridStateRef.current,
        timeAxisState: timeAxisStateRef.current,
        dt: pausedDt,
        targetWindowSecs: cfg.windowSecs,
        tooltipY: cfg.tooltipY,
        tooltipOutline: cfg.tooltipOutline,
        lineVisible,
        lineSmoothValue,
        emptyText: cfg.emptyText,
        loadingAlpha,
        // Show empty overlay when not loading AND loadingAlpha has fully
        // decayed. This prevents the gradient gap from flashing during
        // loading→live (where loadingAlpha starts at ~1), while still
        // allowing smooth fade-out during empty→live (loadingAlpha is 0).
        showEmptyOverlay: !(cfg.loading ?? false) && loadingAlpha < 0.01
      });
      if (badgeRef.current) {
        if (lineModeProg > 0.5 && cfg.showBadge) {
          const momentum = detectMomentum(lineVisible);
          badgeYRef.current = updateBadgeDOM(
            badgeRef.current,
            cfg,
            lineSmoothValue,
            layout,
            momentum,
            badgeYRef.current,
            badgeColorRef.current,
            isWindowTransitioning,
            noMotion,
            ctx,
            pausedDt,
            chartReveal
          );
          const badgeFade = (lineModeProg - 0.5) * 2;
          if (badgeRef.current.container.style.display !== "none") {
            const base = badgeRef.current.container.style.opacity ? parseFloat(badgeRef.current.container.style.opacity) : 1;
            badgeRef.current.container.style.opacity = String(
              base * badgeFade * (1 - pauseProgress)
            );
          }
        } else {
          badgeRef.current.container.style.display = "none";
        }
      }
    } else {
      const effectivePoints = useStash ? lastDataRef.current : points;
      const adaptiveSpeed = computeAdaptiveSpeed(
        cfg.value,
        displayValueRef.current,
        displayMinRef.current,
        displayMaxRef.current,
        cfg.lerpSpeed,
        noMotion
      );
      if (!useStash) {
        displayValueRef.current = lerp(displayValueRef.current, cfg.value, adaptiveSpeed, pausedDt);
        if (pauseProgress < 0.5) {
          const prevRange = displayMaxRef.current - displayMinRef.current || 1;
          if (Math.abs(displayValueRef.current - cfg.value) < prevRange * VALUE_SNAP_THRESHOLD) {
            displayValueRef.current = cfg.value;
          }
        }
      }
      const smoothValue = displayValueRef.current;
      const chartW = w - pad.left - pad.right;
      const needsArrowRoom = cfg.showMomentum;
      const buffer = needsArrowRoom ? Math.max(WINDOW_BUFFER, 37 / Math.max(chartW, 1)) : WINDOW_BUFFER;
      const transition = windowTransitionRef.current;
      if (hasData) frozenNowRef.current = Date.now() / 1e3 - timeDebtRef.current;
      const now = useStash ? frozenNowRef.current : Date.now() / 1e3 - timeDebtRef.current;
      const windowResult = updateWindowTransition(
        cfg,
        transition,
        displayWindowRef.current,
        displayMinRef.current,
        displayMaxRef.current,
        noMotion,
        now_ms,
        now,
        effectivePoints,
        smoothValue,
        buffer
      );
      displayWindowRef.current = windowResult.windowSecs;
      const windowSecs = windowResult.windowSecs;
      const windowTransProgress = windowResult.windowTransProgress;
      const rightEdge = now + windowSecs * buffer;
      const leftEdge = rightEdge - windowSecs;
      const filterRight = rightEdge - (rightEdge - now) * pauseProgress;
      const visible = [];
      for (const p of effectivePoints) {
        if (p.time >= leftEdge - 2 && p.time <= filterRight) {
          visible.push(p);
        }
      }
      if (visible.length < 2) {
        if (badgeRef.current) badgeRef.current.container.style.display = "none";
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      const computedRange = computeRange(visible, smoothValue, cfg.referenceLine?.value, cfg.exaggerate);
      const isWindowTransitioning = transition.startMs > 0;
      const rangeResult = updateRange(
        computedRange,
        rangeInitedRef.current,
        targetMinRef.current,
        targetMaxRef.current,
        displayMinRef.current,
        displayMaxRef.current,
        isWindowTransitioning,
        windowTransProgress,
        transition,
        adaptiveSpeed,
        chartH,
        pausedDt
      );
      rangeInitedRef.current = rangeResult.rangeInited;
      targetMinRef.current = rangeResult.targetMin;
      targetMaxRef.current = rangeResult.targetMax;
      displayMinRef.current = rangeResult.displayMin;
      displayMaxRef.current = rangeResult.displayMax;
      const { minVal, maxVal, valRange } = rangeResult;
      const layout = {
        w,
        h,
        pad,
        chartW,
        chartH,
        leftEdge,
        rightEdge,
        minVal,
        maxVal,
        valRange,
        toX: (t) => pad.left + (t - leftEdge) / (rightEdge - leftEdge) * chartW,
        toY: (v) => pad.top + (1 - (v - minVal) / valRange) * chartH
      };
      const momentum = cfg.momentumOverride ?? detectMomentum(visible);
      const hoverResult = updateHoverState(
        hoverXRef.current,
        pad,
        w,
        layout,
        now,
        visible,
        scrubAmountRef.current,
        lastHoverRef.current,
        cfg,
        noMotion,
        leftEdge,
        rightEdge,
        chartW,
        dt
      );
      scrubAmountRef.current = hoverResult.scrubAmount;
      lastHoverRef.current = hoverResult.lastHover;
      const { hoverX: drawHoverX, hoverValue: drawHoverValue, hoverTime: drawHoverTime } = hoverResult;
      const lookback = Math.min(5, visible.length - 1);
      const recentDelta = lookback > 0 ? Math.abs(visible[visible.length - 1].value - visible[visible.length - 1 - lookback].value) : 0;
      const swingMagnitude = valRange > 0 ? Math.min(recentDelta / valRange, 1) : 0;
      drawFrame(ctx, layout, cfg.palette, {
        visible,
        smoothValue,
        now,
        momentum,
        arrowState: arrowStateRef.current,
        showGrid: cfg.showGrid,
        showMomentum: cfg.showMomentum,
        showPulse: cfg.showPulse,
        showFill: cfg.showFill,
        referenceLine: cfg.referenceLine,
        hoverX: drawHoverX,
        hoverValue: drawHoverValue,
        hoverTime: drawHoverTime,
        scrubAmount: scrubAmountRef.current,
        windowSecs,
        formatValue: cfg.formatValue,
        formatTime: cfg.formatTime,
        gridState: gridStateRef.current,
        timeAxisState: timeAxisStateRef.current,
        dt,
        targetWindowSecs: cfg.windowSecs,
        tooltipY: cfg.tooltipY,
        tooltipOutline: cfg.tooltipOutline,
        orderbookData: cfg.orderbookData,
        orderbookState: cfg.orderbookData ? orderbookStateRef.current : void 0,
        particleState: cfg.degenOptions ? particleStateRef.current : void 0,
        particleOptions: cfg.degenOptions,
        swingMagnitude,
        shakeState: cfg.degenOptions ? shakeStateRef.current : void 0,
        chartReveal,
        pauseProgress,
        now_ms
      });
      const bgAlpha = 1 - chartReveal;
      if (bgAlpha > 0.01 && revealTarget === 0 && !cfg.loading) {
        const bgEmptyAlpha = (1 - loadingAlpha) * bgAlpha;
        if (bgEmptyAlpha > 0.01) {
          drawEmpty(ctx, w, h, pad, cfg.palette, bgEmptyAlpha, now_ms, true, cfg.emptyText);
        }
      }
      const badge = badgeRef.current;
      if (badge) {
        badgeYRef.current = updateBadgeDOM(
          badge,
          cfg,
          smoothValue,
          layout,
          momentum,
          badgeYRef.current,
          badgeColorRef.current,
          isWindowTransitioning,
          noMotion,
          ctx,
          pausedDt,
          chartReveal
        );
        if (pauseProgress > 0.01 && badge.container.style.display !== "none") {
          const base = badge.container.style.opacity ? parseFloat(badge.container.style.opacity) : 1;
          badge.container.style.opacity = String(base * (1 - pauseProgress));
        }
      }
      const valEl = cfg.valueDisplayRef?.current;
      if (valEl) {
        const displayVal = cfg.valueMomentumColor ? Math.abs(smoothValue) : smoothValue;
        valEl.textContent = cfg.formatValue(displayVal);
        if (cfg.valueMomentumColor) {
          const mc = momentum === "up" ? "#22c55e" : momentum === "down" ? "#ef4444" : "";
          if (mc) valEl.style.color = mc;
          else valEl.style.removeProperty("color");
        }
      }
    }
    rafRef.current = requestAnimationFrame(draw);
  }, [canvasRef]);
  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);
}

// src/Liveline.tsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var defaultFormatValue = (v) => v.toFixed(2);
var defaultFormatTime = (t) => {
  const d = new Date(t * 1e3);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
};
function Liveline({
  data,
  value,
  theme = "dark",
  color = "#3b82f6",
  window: windowSecs = 30,
  grid = true,
  badge = true,
  momentum = true,
  fill = true,
  scrub = true,
  loading = false,
  paused = false,
  emptyText,
  exaggerate = false,
  degen: degenProp,
  badgeTail = true,
  badgeVariant = "default",
  showValue = false,
  valueMomentumColor = false,
  windows,
  onWindowChange,
  windowStyle,
  tooltipY = 14,
  tooltipOutline = true,
  orderbook,
  referenceLine,
  formatValue = defaultFormatValue,
  formatTime = defaultFormatTime,
  lerpSpeed = 0.08,
  padding: paddingOverride,
  onHover,
  cursor = "crosshair",
  pulse = true,
  mode = "line",
  candles,
  candleWidth,
  bullColor,
  bearColor,
  liveCandle,
  lineMode,
  lineData,
  lineValue,
  onModeChange,
  className,
  style
}) {
  const canvasRef = useRef2(null);
  const containerRef = useRef2(null);
  const valueDisplayRef = useRef2(null);
  const windowBarRef = useRef2(null);
  const windowBtnRefs = useRef2(/* @__PURE__ */ new Map());
  const [indicatorStyle, setIndicatorStyle] = useState(null);
  const modeBarRef = useRef2(null);
  const modeBtnRefs = useRef2(/* @__PURE__ */ new Map());
  const [modeIndicatorStyle, setModeIndicatorStyle] = useState(null);
  const palette = useMemo(() => resolveTheme(color, theme), [color, theme]);
  const isDark = theme === "dark";
  const showMomentum = momentum !== false;
  const momentumOverride = typeof momentum === "string" ? momentum : void 0;
  const pad = {
    top: paddingOverride?.top ?? 12,
    right: paddingOverride?.right ?? 80,
    bottom: paddingOverride?.bottom ?? 28,
    left: paddingOverride?.left ?? 12
  };
  const degenEnabled = degenProp != null ? degenProp !== false : false;
  const degenOptions = degenEnabled ? typeof degenProp === "object" ? degenProp : {} : void 0;
  const [activeWindowSecs, setActiveWindowSecs] = useState(
    windows && windows.length > 0 ? windows[0].secs : windowSecs
  );
  const effectiveWindowSecs = windows ? activeWindowSecs : windowSecs;
  useLayoutEffect(() => {
    if (!windows || windows.length === 0) return;
    const btn = windowBtnRefs.current.get(activeWindowSecs);
    const bar = windowBarRef.current;
    if (btn && bar) {
      const barRect = bar.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setIndicatorStyle({
        left: btnRect.left - barRect.left,
        width: btnRect.width
      });
    }
  }, [activeWindowSecs, windows]);
  const activeMode = lineMode ? "line" : "candle";
  useLayoutEffect(() => {
    if (!onModeChange) return;
    const btn = modeBtnRefs.current.get(activeMode);
    const bar = modeBarRef.current;
    if (btn && bar) {
      const barRect = bar.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setModeIndicatorStyle({
        left: btnRect.left - barRect.left,
        width: btnRect.width
      });
    }
  }, [activeMode, onModeChange]);
  const ws = windowStyle ?? "default";
  useLivelineEngine(canvasRef, containerRef, {
    data,
    value,
    palette,
    windowSecs: effectiveWindowSecs,
    lerpSpeed,
    showGrid: grid,
    showBadge: badge,
    showMomentum,
    momentumOverride,
    showFill: fill,
    referenceLine,
    formatValue,
    formatTime,
    padding: pad,
    onHover,
    showPulse: pulse,
    scrub,
    exaggerate,
    degenOptions,
    badgeTail,
    badgeVariant,
    tooltipY,
    tooltipOutline,
    valueMomentumColor,
    valueDisplayRef: showValue ? valueDisplayRef : void 0,
    orderbookData: orderbook,
    loading,
    paused,
    emptyText,
    mode,
    candles,
    candleWidth,
    bullColor,
    bearColor,
    liveCandle,
    lineMode,
    lineData,
    lineValue
  });
  const cursorStyle = scrub ? cursor : "default";
  const activeColor = isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.55)";
  const inactiveColor = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.22)";
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    showValue && /* @__PURE__ */ jsx(
      "span",
      {
        ref: valueDisplayRef,
        style: {
          display: "block",
          fontSize: 20,
          fontWeight: 500,
          fontFamily: '"SF Mono", Menlo, monospace',
          color: isDark ? "rgba(255,255,255,0.85)" : "#111",
          transition: "color 0.3s",
          letterSpacing: "-0.01em",
          marginBottom: 8,
          paddingTop: 4,
          paddingLeft: pad.left
        }
      }
    ),
    (windows && windows.length > 0 || onModeChange) && /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 6, marginLeft: pad.left }, children: [
      windows && windows.length > 0 && /* @__PURE__ */ jsxs(
        "div",
        {
          ref: windowBarRef,
          style: {
            position: "relative",
            display: "inline-flex",
            gap: ws === "text" ? 4 : 2,
            background: ws === "text" ? "transparent" : isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
            borderRadius: ws === "rounded" ? 999 : 6,
            padding: ws === "text" ? 0 : ws === "rounded" ? 3 : 2
          },
          children: [
            ws !== "text" && indicatorStyle && /* @__PURE__ */ jsx("div", { style: {
              position: "absolute",
              top: ws === "rounded" ? 3 : 2,
              left: indicatorStyle.left,
              width: indicatorStyle.width,
              height: ws === "rounded" ? "calc(100% - 6px)" : "calc(100% - 4px)",
              background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.035)",
              borderRadius: ws === "rounded" ? 999 : 4,
              transition: "left 0.25s cubic-bezier(0.4, 0, 0.2, 1), width 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
              pointerEvents: "none"
            } }),
            windows.map((w) => {
              const isActive = w.secs === activeWindowSecs;
              return /* @__PURE__ */ jsx(
                "button",
                {
                  ref: (el) => {
                    if (el) windowBtnRefs.current.set(w.secs, el);
                    else windowBtnRefs.current.delete(w.secs);
                  },
                  onClick: () => {
                    setActiveWindowSecs(w.secs);
                    onWindowChange?.(w.secs);
                  },
                  style: {
                    position: "relative",
                    zIndex: 1,
                    fontSize: 11,
                    padding: ws === "text" ? "2px 6px" : "3px 10px",
                    borderRadius: ws === "rounded" ? 999 : 4,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    fontWeight: isActive ? 600 : 400,
                    background: "transparent",
                    color: isActive ? activeColor : inactiveColor,
                    transition: "color 0.2s, background 0.15s",
                    lineHeight: "16px"
                  },
                  children: w.label
                },
                w.secs
              );
            })
          ]
        }
      ),
      onModeChange && /* @__PURE__ */ jsxs(
        "div",
        {
          ref: modeBarRef,
          style: {
            position: "relative",
            display: "inline-flex",
            gap: 2,
            background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
            borderRadius: 6,
            padding: 2
          },
          children: [
            modeIndicatorStyle && /* @__PURE__ */ jsx("div", { style: {
              position: "absolute",
              top: 2,
              left: modeIndicatorStyle.left,
              width: modeIndicatorStyle.width,
              height: "calc(100% - 4px)",
              background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.035)",
              borderRadius: 4,
              transition: "left 0.25s cubic-bezier(0.4, 0, 0.2, 1), width 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
              pointerEvents: "none"
            } }),
            /* @__PURE__ */ jsx(
              "button",
              {
                ref: (el) => {
                  if (el) modeBtnRefs.current.set("line", el);
                  else modeBtnRefs.current.delete("line");
                },
                onClick: () => onModeChange("line"),
                style: {
                  position: "relative",
                  zIndex: 1,
                  padding: "5px 7px",
                  borderRadius: 4,
                  border: "none",
                  cursor: "pointer",
                  background: "transparent",
                  display: "flex",
                  alignItems: "center"
                },
                children: /* @__PURE__ */ jsx("svg", { width: "12", height: "12", viewBox: "0 0 12 12", fill: "none", children: /* @__PURE__ */ jsx(
                  "path",
                  {
                    d: "M1 8.5C2.5 8.5 3 4 5.5 4S7.5 7 8.5 7C9.5 7 10 3.5 11 3.5",
                    stroke: activeMode === "line" ? activeColor : inactiveColor,
                    strokeWidth: activeMode === "line" ? 1.5 : 1.2,
                    strokeLinecap: "round",
                    fill: "none"
                  }
                ) })
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                ref: (el) => {
                  if (el) modeBtnRefs.current.set("candle", el);
                  else modeBtnRefs.current.delete("candle");
                },
                onClick: () => onModeChange("candle"),
                style: {
                  position: "relative",
                  zIndex: 1,
                  padding: "5px 7px",
                  borderRadius: 4,
                  border: "none",
                  cursor: "pointer",
                  background: "transparent",
                  display: "flex",
                  alignItems: "center"
                },
                children: /* @__PURE__ */ jsxs("svg", { width: "12", height: "12", viewBox: "0 0 12 12", fill: "none", children: [
                  /* @__PURE__ */ jsx(
                    "line",
                    {
                      x1: "3.5",
                      y1: "1",
                      x2: "3.5",
                      y2: "11",
                      stroke: activeMode === "candle" ? activeColor : inactiveColor,
                      strokeWidth: "1"
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "rect",
                    {
                      x: "2",
                      y: "3",
                      width: "3",
                      height: "5",
                      rx: "0.5",
                      fill: activeMode === "candle" ? activeColor : inactiveColor
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "line",
                    {
                      x1: "8.5",
                      y1: "2",
                      x2: "8.5",
                      y2: "10",
                      stroke: activeMode === "candle" ? activeColor : inactiveColor,
                      strokeWidth: "1"
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "rect",
                    {
                      x: "7",
                      y: "4",
                      width: "3",
                      height: "4",
                      rx: "0.5",
                      fill: activeMode === "candle" ? activeColor : inactiveColor
                    }
                  )
                ] })
              }
            )
          ]
        }
      )
    ] }),
    /* @__PURE__ */ jsx(
      "div",
      {
        ref: containerRef,
        className,
        style: {
          width: "100%",
          height: "100%",
          position: "relative",
          ...style
        },
        children: /* @__PURE__ */ jsx(
          "canvas",
          {
            ref: canvasRef,
            style: { display: "block", cursor: cursorStyle }
          }
        )
      }
    )
  ] });
}

// src/LivelineTransition.tsx
import { useState as useState2, useEffect as useEffect2, useRef as useRef3 } from "react";
import { jsx as jsx2 } from "react/jsx-runtime";
function LivelineTransition({
  active,
  children,
  duration = 300,
  className,
  style
}) {
  const childArray = Array.isArray(children) ? children : [children];
  const [mounted, setMounted] = useState2(() => /* @__PURE__ */ new Set([active]));
  const [visible, setVisible] = useState2(active);
  const prevRef = useRef3(active);
  useEffect2(() => {
    if (active === prevRef.current) return () => {
    };
    const oldKey = prevRef.current;
    prevRef.current = active;
    setMounted((prev) => /* @__PURE__ */ new Set([...prev, active]));
    let raf1 = requestAnimationFrame(() => {
      raf1 = requestAnimationFrame(() => setVisible(active));
    });
    const timer = setTimeout(() => {
      setMounted((prev) => {
        const next = new Set(prev);
        next.delete(oldKey);
        return next;
      });
    }, duration + 50);
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(timer);
    };
  }, [active, duration]);
  return /* @__PURE__ */ jsx2("div", { className, style: { position: "relative", width: "100%", height: "100%", ...style }, children: childArray.map((child) => {
    const key = String(child.key ?? "");
    if (!mounted.has(key)) return null;
    const isActive = key === visible;
    return /* @__PURE__ */ jsx2(
      "div",
      {
        style: {
          position: "absolute",
          inset: 0,
          opacity: isActive ? 1 : 0,
          transition: `opacity ${duration}ms ease`,
          pointerEvents: isActive ? "auto" : "none"
        },
        children: child
      },
      key
    );
  }) });
}
export {
  Liveline,
  LivelineTransition
};
