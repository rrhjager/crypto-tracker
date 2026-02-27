// src/lib/taScore.ts
export type Status = 'BUY' | 'HOLD' | 'SELL'

export type MAStruct    = { ma50: number | null; ma200: number | null }
export type MACDStruct  = { hist: number | null }
export type VolumeStruct= { ratio: number | null }
export type TrendStruct = { ret20: number | null; rangePos20: number | null }
export type VolatilityStruct = { stdev20: number | null }

export function statusFromScore(score: number): Status {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

// ——— Agressiever profiel (identiek voor alle pagina’s) ———
const AGGR = {
  // MA: sneller naar extremen (was 0.20 spread-window; nu 0.12)
  ma: { window: 0.12, bullBase: 62, bearBase: 38 }, // basis + range 40 blijft
  // RSI: center 50, “gamma” wat hoger zodat extremer weegt
  rsi: { center: 50, gamma: 1.30 },
  // MACD: normalizeer hist t.o.v. MA50; strakker threshold
  macd: { ref: 0.006, scale: 22 }, // 0.6% van MA50 ≈ sterk signaal
  // Volume: center rond 1.0 met hogere gain
  vol: { gain: 45 }, // was ~50±30 → nu ±45
  // Trend (nieuw): 20d return + positie in 20d range
  trend: { retRefPct: 14, gain: 38 },
  // Vol-regime (nieuw): mild belonen in “handelbare” band, extreem vol afstraffen
  volReg: { low: 0.006, mid: 0.028, high: 0.075 },
  // Consensus (nieuw): alignment van MA/RSI/MACD richting
  consensus: { gain: 34, rsiBand: 5 },
}

/**
 * Eén bron van waarheid voor de score (homepage, overzicht, detail).
 * Weging (met extra features): MA 24% · RSI 16% · MACD 16% · Volume 10%
 * + Trend 18% · Vol-regime 8% · Consensus 8%
 * Ontbrekende onderdelen worden automatisch herwogen.
 */
export function computeScoreStatus(ind: {
  ma?: MAStruct | null
  rsi?: number | null
  macd?: MACDStruct | null
  volume?: VolumeStruct | null
  trend?: TrendStruct | null
  volatility?: VolatilityStruct | null
}): { score: number; status: Status } {
  // --- MA (24%)
  let maScore = 50
  let hasMA = false
  if (ind.ma?.ma50 != null && ind.ma?.ma200 != null) {
    const { ma50, ma200 } = ind.ma
    hasMA = true
    const W = Math.max(1e-9, AGGR.ma.window)
    if (ma50 > ma200) {
      const spread = clamp(ma50 / Math.max(1e-9, ma200) - 1, 0, AGGR.ma.window)
      maScore = AGGR.ma.bullBase + (spread / W) * 40 // tot max 102 maar clamped later
    } else if (ma50 < ma200) {
      const spread = clamp(ma200 / Math.max(1e-9, ma50) - 1, 0, AGGR.ma.window)
      maScore = AGGR.ma.bearBase - (spread / W) * 40
    }
  }
  maScore = clamp(maScore, 0, 100)

  // --- RSI (16%) — projecteer 30..70 op 0..100 en maak agressiever
  let rsiScore = 50
  let hasRSI = false
  if (typeof ind.rsi === 'number') {
    hasRSI = true
    const base = clamp(((ind.rsi - 30) / 40) * 100, 0, 100) // 30..70 → 0..100
    // aggressiever: boost afstand tot 50
    const delta = (base - 50) * AGGR.rsi.gamma
    rsiScore = clamp(50 + delta, 0, 100)
  }

  // --- MACD (16%) — normaliseer hist t.o.v. MA50
  let macdScore = 50
  let hasMACD = false
  const hist = ind.macd?.hist
  const ref = ind.ma?.ma50 ?? null
  if (typeof hist === 'number') {
    hasMACD = true
    if (ref && ref > 0) {
      // rel = (hist/ma50)/ref → clamp -1..1 → 50 ± scale*rel
      const rel = clamp((hist / ref) / Math.max(1e-9, AGGR.macd.ref), -1, 1)
      macdScore = clamp(50 + rel * AGGR.macd.scale, 0, 100)
    } else {
      macdScore = hist > 0 ? 65 : hist < 0 ? 35 : 50 // iets agressiever dan 60/40
    }
  }

  // --- Volume (10%) — ratio rond 1.0
  let volScore = 50
  let hasVOL = false
  const ratio = ind.volume?.ratio
  if (typeof ratio === 'number') {
    hasVOL = true
    // delta (±1) → 50 ± gain
    const delta = clamp(ratio - 1, -1, 1)
    volScore = clamp(50 + delta * AGGR.vol.gain, 0, 100)
  }

  // --- Trend (18%) — ret20 + range-pos20
  let trendScore = 50
  let hasTrend = false
  const ret20 = ind.trend?.ret20
  const rangePos20 = ind.trend?.rangePos20
  if (typeof ret20 === 'number' || typeof rangePos20 === 'number') {
    hasTrend = true
    const m = typeof ret20 === 'number'
      ? clamp(ret20 / Math.max(1e-9, AGGR.trend.retRefPct), -1, 1)
      : 0
    const p = typeof rangePos20 === 'number'
      ? clamp((rangePos20 - 0.5) * 2, -1, 1)
      : 0
    const mix = 0.6 * m + 0.4 * p
    trendScore = clamp(50 + mix * AGGR.trend.gain, 0, 100)
  }

  // --- Volatility regime (8%) — te laag/te hoog is minder betrouwbaar
  let volRegScore = 50
  let hasVolReg = false
  const stdev20 = ind.volatility?.stdev20
  if (typeof stdev20 === 'number') {
    hasVolReg = true
    const { low, mid, high } = AGGR.volReg
    if (stdev20 <= low) {
      volRegScore = 45 + (stdev20 / Math.max(1e-9, low)) * 20
    } else if (stdev20 <= mid) {
      volRegScore = 65 + ((stdev20 - low) / Math.max(1e-9, mid - low)) * 20
    } else if (stdev20 <= high) {
      volRegScore = 85 - ((stdev20 - mid) / Math.max(1e-9, high - mid)) * 55
    } else {
      volRegScore = 22
    }
    volRegScore = clamp(volRegScore, 0, 100)
  }

  // --- Consensus (8%) — wanneer MA/RSI/MACD niet uitlijnen, minder agressief
  let consensusScore = 50
  let hasConsensus = false
  const dirs: number[] = []
  if (hasMA && ind.ma) {
    const { ma50, ma200 } = ind.ma
    if (ma50 != null && ma200 != null) dirs.push(ma50 > ma200 ? 1 : ma50 < ma200 ? -1 : 0)
  }
  if (hasRSI && typeof ind.rsi === 'number') {
    const band = AGGR.consensus.rsiBand
    dirs.push(ind.rsi > 50 + band ? 1 : ind.rsi < 50 - band ? -1 : 0)
  }
  if (hasMACD && typeof hist === 'number') {
    dirs.push(hist > 0 ? 1 : hist < 0 ? -1 : 0)
  }
  const nonZero = dirs.filter(d => d !== 0)
  if (nonZero.length >= 2) {
    hasConsensus = true
    const avgDir = nonZero.reduce((s, d) => s + d, 0) / nonZero.length // -1..1
    consensusScore = clamp(50 + avgDir * AGGR.consensus.gain, 0, 100)
  }

  const parts: Array<{ w: number; v: number }> = []
  if (hasMA) parts.push({ w: 0.24, v: maScore })
  if (hasRSI) parts.push({ w: 0.16, v: rsiScore })
  if (hasMACD) parts.push({ w: 0.16, v: macdScore })
  if (hasVOL) parts.push({ w: 0.10, v: volScore })
  if (hasTrend) parts.push({ w: 0.18, v: trendScore })
  if (hasVolReg) parts.push({ w: 0.08, v: volRegScore })
  if (hasConsensus) parts.push({ w: 0.08, v: consensusScore })

  if (!parts.length) return { score: 50, status: 'HOLD' }

  const wSum = parts.reduce((s, p) => s + p.w, 0)
  const rawScore = parts.reduce((s, p) => s + p.v * (p.w / wSum), 0)
  const score = Math.round(clamp(rawScore, 0, 100))
  return { score, status: statusFromScore(score) }
}
