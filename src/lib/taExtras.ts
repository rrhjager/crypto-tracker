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
  adx14: number | null
  relBench20: number | null
  relBench60: number | null
}

export type VolatilityStruct = {
  stdev20: number | null
  atrPct14: number | null
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

export function atrPctAt(highs: number[], lows: number[], closes: number[], i: number, period = 14): number | null {
  if (i <= 0 || i - period + 1 < 1 || i >= closes.length) return null
  let sumTr = 0
  let n = 0
  for (let k = i - period + 1; k <= i; k++) {
    const high = highs[k]
    const low = lows[k]
    const prevClose = closes[k - 1]
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(prevClose) || prevClose <= 0) continue
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )
    if (!Number.isFinite(tr)) continue
    sumTr += tr
    n += 1
  }
  if (!n) return null
  const atr = sumTr / n
  const cur = closes[i]
  if (!Number.isFinite(cur) || cur <= 0) return null
  return (atr / cur) * 100
}

export function adxAt(highs: number[], lows: number[], closes: number[], i: number, period = 14): number | null {
  if (i <= period * 2 || i >= closes.length) return null

  const trs: number[] = []
  const plusDMs: number[] = []
  const minusDMs: number[] = []

  for (let k = 1; k <= i; k++) {
    const high = highs[k]
    const low = lows[k]
    const prevHigh = highs[k - 1]
    const prevLow = lows[k - 1]
    const prevClose = closes[k - 1]
    if (
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(prevHigh) ||
      !Number.isFinite(prevLow) ||
      !Number.isFinite(prevClose)
    ) {
      trs.push(0)
      plusDMs.push(0)
      minusDMs.push(0)
      continue
    }

    const upMove = high - prevHigh
    const downMove = prevLow - low
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0)
    trs.push(
      Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      )
    )
  }

  if (trs.length <= period) return null

  let trN = 0
  let plusDMN = 0
  let minusDMN = 0
  for (let k = 1; k <= period; k++) {
    trN += trs[k] ?? 0
    plusDMN += plusDMs[k] ?? 0
    minusDMN += minusDMs[k] ?? 0
  }

  const dxValues: number[] = []

  for (let k = period + 1; k <= i; k++) {
    trN = trN - trN / period + (trs[k] ?? 0)
    plusDMN = plusDMN - plusDMN / period + (plusDMs[k] ?? 0)
    minusDMN = minusDMN - minusDMN / period + (minusDMs[k] ?? 0)

    if (trN <= 1e-12) {
      dxValues.push(0)
      continue
    }

    const plusDI = (100 * plusDMN) / trN
    const minusDI = (100 * minusDMN) / trN
    const diSum = plusDI + minusDI
    if (diSum <= 1e-12) {
      dxValues.push(0)
      continue
    }
    dxValues.push((100 * Math.abs(plusDI - minusDI)) / diSum)
  }

  if (dxValues.length < period) return null

  let adx = dxValues.slice(0, period).reduce((sum, v) => sum + v, 0) / period
  for (let k = period; k < dxValues.length; k++) {
    adx = ((adx * (period - 1)) + dxValues[k]) / period
  }

  return clamp(adx, 0, 100)
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

export function relativeReturnSpread(closes: number[], benchmarkCloses: number[], lookback = 20): number | null {
  const size = Math.min(closes.length, benchmarkCloses.length)
  if (size < lookback + 1) return null
  const asset = closes.slice(-size)
  const bench = benchmarkCloses.slice(-size)
  const assetFrom = asset[size - lookback - 1]
  const assetTo = asset[size - 1]
  const benchFrom = bench[size - lookback - 1]
  const benchTo = bench[size - 1]
  if (
    !Number.isFinite(assetFrom) ||
    !Number.isFinite(assetTo) ||
    !Number.isFinite(benchFrom) ||
    !Number.isFinite(benchTo) ||
    assetFrom <= 0 ||
    benchFrom <= 0
  ) return null
  const assetRet = ((assetTo / assetFrom) - 1) * 100
  const benchRet = ((benchTo / benchFrom) - 1) * 100
  return assetRet - benchRet
}

export function latestRelativeStrengthFeatures(closes: number[], benchmarkCloses?: number[] | null) {
  return {
    relBench20: benchmarkCloses?.length ? relativeReturnSpread(closes, benchmarkCloses, 20) : null,
    relBench60: benchmarkCloses?.length ? relativeReturnSpread(closes, benchmarkCloses, 60) : null,
  }
}

export function latestRangeStrengthFeatures(highs?: number[] | null, lows?: number[] | null, closes?: number[] | null) {
  if (!highs?.length || !lows?.length || !closes?.length) {
    return { adx14: null, atrPct14: null }
  }
  const size = Math.min(highs.length, lows.length, closes.length)
  if (size < 30) {
    return { adx14: null, atrPct14: null }
  }
  const h = highs.slice(-size)
  const l = lows.slice(-size)
  const c = closes.slice(-size)
  const i = size - 1
  return {
    adx14: adxAt(h, l, c, i, 14),
    atrPct14: atrPctAt(h, l, c, i, 14),
  }
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
    adx14: null,
    relBench20: null,
    relBench60: null,
  }
}

export function latestVolatilityFeatures(closes: number[], lookback = 20): VolatilityStruct {
  const i = closes.length - 1
  return {
    stdev20: realizedVolatilityAt(closes, i, lookback),
    atrPct14: null,
  }
}
