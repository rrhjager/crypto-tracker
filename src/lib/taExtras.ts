// src/lib/taExtras.ts
export type TrendStruct = {
  ret5: number | null
  ret20: number | null
  ret60: number | null
  rangePos20: number | null
  rangePos55: number | null
  efficiency14: number | null
  breakout20: number | null
  breakout55: number | null
  stretch20: number | null
}

export type VolatilityStruct = {
  stdev20: number | null
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

export function lookbackReturnPctAt(closes: number[], i: number, lookback = 20): number | null {
  if (i < 0 || i - lookback < 0 || i >= closes.length) return null
  const from = closes[i - lookback]
  const to = closes[i]
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  return ((to / from) - 1) * 100
}

export function rangePositionAt(closes: number[], i: number, lookback = 20): number | null {
  if (i < 0 || i - lookback + 1 < 0 || i >= closes.length) return null
  let lo = Infinity
  let hi = -Infinity
  for (let k = i - lookback + 1; k <= i; k++) {
    const v = closes[k]
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  const span = hi - lo
  if (span <= 1e-12) return 0.5
  return clamp((closes[i] - lo) / span, 0, 1)
}

export function realizedVolatilityAt(closes: number[], i: number, lookback = 20): number | null {
  if (i < 0 || i - lookback < 0 || i >= closes.length) return null
  let n = 0
  let sum = 0
  let sumSq = 0
  for (let k = i - lookback + 1; k <= i; k++) {
    const a = closes[k - 1]
    const b = closes[k]
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) continue
    const r = (b - a) / a
    n += 1
    sum += r
    sumSq += r * r
  }
  if (!n) return null
  const mean = sum / n
  const variance = Math.max(0, sumSq / n - mean * mean)
  return Math.sqrt(variance)
}

export function trendEfficiencyAt(closes: number[], i: number, lookback = 14): number | null {
  if (i < 0 || i - lookback < 0 || i >= closes.length) return null
  const from = closes[i - lookback]
  const to = closes[i]
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null

  let path = 0
  for (let k = i - lookback + 1; k <= i; k++) {
    const a = closes[k - 1]
    const b = closes[k]
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    path += Math.abs(b - a)
  }

  if (path <= 1e-12) return 0
  return clamp(Math.abs(to - from) / path, 0, 1)
}

function smaAt(closes: number[], i: number, lookback = 20): number | null {
  if (i < 0 || i - lookback + 1 < 0 || i >= closes.length) return null
  let sum = 0
  let n = 0
  for (let k = i - lookback + 1; k <= i; k++) {
    const v = closes[k]
    if (!Number.isFinite(v)) continue
    sum += v
    n += 1
  }
  if (!n) return null
  return sum / n
}

export function breakoutBiasAt(closes: number[], i: number, lookback = 20): number | null {
  if (i <= 0 || i - lookback < 0 || i >= closes.length) return null
  let lo = Infinity
  let hi = -Infinity
  for (let k = i - lookback; k <= i - 1; k++) {
    const v = closes[k]
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  const cur = closes[i]
  if (!Number.isFinite(cur) || cur <= 0) return null

  if (cur > hi) {
    const pct = ((cur / hi) - 1) * 100
    return clamp(0.65 + pct / 10, -1, 1)
  }
  if (cur < lo) {
    const pct = ((cur / lo) - 1) * 100
    return clamp(-0.65 + pct / 10, -1, 1)
  }

  const span = hi - lo
  if (span <= 1e-12) return 0
  const pos = clamp((cur - lo) / span, 0, 1)
  return clamp((pos - 0.5) * 1.6, -0.8, 0.8)
}

export function stretchFromSmaPctAt(closes: number[], i: number, lookback = 20): number | null {
  const ma = smaAt(closes, i, lookback)
  const cur = closes[i]
  if (!Number.isFinite(ma) || !Number.isFinite(cur) || !ma || ma <= 0) return null
  return ((cur / ma) - 1) * 100
}

export function latestTrendFeatures(closes: number[], lookback = 20): TrendStruct {
  const i = closes.length - 1
  return {
    ret5: lookbackReturnPctAt(closes, i, 5),
    ret20: lookbackReturnPctAt(closes, i, lookback),
    ret60: lookbackReturnPctAt(closes, i, Math.max(lookback * 3, lookback + 20)),
    rangePos20: rangePositionAt(closes, i, lookback),
    rangePos55: rangePositionAt(closes, i, Math.max(55, lookback * 2 + 15)),
    efficiency14: trendEfficiencyAt(closes, i, 14),
    breakout20: breakoutBiasAt(closes, i, lookback),
    breakout55: breakoutBiasAt(closes, i, Math.max(55, lookback * 2 + 15)),
    stretch20: stretchFromSmaPctAt(closes, i, lookback),
  }
}

export function latestVolatilityFeatures(closes: number[], lookback = 20): VolatilityStruct {
  const i = closes.length - 1
  return {
    stdev20: realizedVolatilityAt(closes, i, lookback),
  }
}
