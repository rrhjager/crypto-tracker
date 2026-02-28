// src/lib/taExtras.ts
export type TrendStruct = {
  ret20: number | null
  ret60: number | null
  rangePos20: number | null
  efficiency14: number | null
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

export function latestTrendFeatures(closes: number[], lookback = 20): TrendStruct {
  const i = closes.length - 1
  return {
    ret20: lookbackReturnPctAt(closes, i, lookback),
    ret60: lookbackReturnPctAt(closes, i, Math.max(lookback * 3, lookback + 20)),
    rangePos20: rangePositionAt(closes, i, lookback),
    efficiency14: trendEfficiencyAt(closes, i, 14),
  }
}

export function latestVolatilityFeatures(closes: number[], lookback = 20): VolatilityStruct {
  const i = closes.length - 1
  return {
    stdev20: realizedVolatilityAt(closes, i, lookback),
  }
}
