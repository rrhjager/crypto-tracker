// src/lib/taScore.ts
export type Status = 'BUY' | 'HOLD' | 'SELL'
export type ScoreMarket =
  | 'DEFAULT'
  | 'CRYPTO'
  | 'AEX'
  | 'DAX'
  | 'DOWJONES'
  | 'ETFS'
  | 'FTSE100'
  | 'HANGSENG'
  | 'NASDAQ'
  | 'NIKKEI225'
  | 'SENSEX'
  | 'SP500'
export type ScoreMode = 'STANDARD' | 'HIGH_CONF'

export type MAStruct    = { ma50: number | null; ma200: number | null }
export type MACDStruct  = { hist: number | null }
export type VolumeStruct= { ratio: number | null }
export type TrendStruct = {
  ret5?: number | null
  ret20: number | null
  ret60?: number | null
  rangePos20: number | null
  rangePos55?: number | null
  efficiency14?: number | null
  breakout20?: number | null
  breakout55?: number | null
  stretch20?: number | null
}
export type VolatilityStruct = { stdev20: number | null }

export function statusFromScore(score: number): Status {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

type WeightKey = 'ma' | 'rsi' | 'macd' | 'vol' | 'trend' | 'volReg' | 'consensus'

type MarketProfile = {
  thresholds: { buy: number; sell: number; minConfidence: number }
  weightMult?: Partial<Record<WeightKey, number>>
}

const BASE_WEIGHTS: Record<WeightKey, number> = {
  ma: 0.24,
  rsi: 0.16,
  macd: 0.16,
  vol: 0.10,
  trend: 0.18,
  volReg: 0.08,
  consensus: 0.08,
}

const MARKET_PROFILES: Record<ScoreMarket, MarketProfile> = {
  DEFAULT: {
    thresholds: { buy: 66, sell: 33, minConfidence: 0.50 },
  },
  CRYPTO: {
    thresholds: { buy: 66, sell: 33, minConfidence: 0.48 },
    weightMult: { trend: 1.08, volReg: 0.95, vol: 0.95, consensus: 1.04 },
  },
  AEX: {
    thresholds: { buy: 66, sell: 33, minConfidence: 0.50 },
  },
  DAX: {
    thresholds: { buy: 67, sell: 33, minConfidence: 0.56 },
    weightMult: { trend: 1.10, consensus: 1.10, vol: 0.80, volReg: 1.05 },
  },
  DOWJONES: {
    thresholds: { buy: 66, sell: 33, minConfidence: 0.54 },
    weightMult: { trend: 1.08, consensus: 1.08, vol: 0.85 },
  },
  ETFS: {
    thresholds: { buy: 66, sell: 33, minConfidence: 0.54 },
    weightMult: { trend: 1.08, consensus: 1.08, vol: 0.82, volReg: 1.06 },
  },
  FTSE100: {
    thresholds: { buy: 66, sell: 33, minConfidence: 0.50 },
    weightMult: { trend: 1.05, consensus: 1.05, vol: 0.88 },
  },
  HANGSENG: {
    thresholds: { buy: 66, sell: 33, minConfidence: 0.53 },
    weightMult: { trend: 1.09, consensus: 1.08, vol: 0.84, volReg: 1.05 },
  },
  NASDAQ: {
    thresholds: { buy: 67, sell: 33, minConfidence: 0.57 },
    weightMult: { trend: 1.12, consensus: 1.12, vol: 0.78, volReg: 1.06 },
  },
  NIKKEI225: {
    thresholds: { buy: 66, sell: 33, minConfidence: 0.51 },
    weightMult: { trend: 1.06, consensus: 1.06, vol: 0.88 },
  },
  SENSEX: {
    thresholds: { buy: 66, sell: 33, minConfidence: 0.50 },
  },
  SP500: {
    thresholds: { buy: 67, sell: 33, minConfidence: 0.57 },
    weightMult: { trend: 1.12, consensus: 1.10, vol: 0.80, volReg: 1.06 },
  },
}

const MARKET_ALIASES: Record<string, ScoreMarket> = {
  DEFAULT: 'DEFAULT',
  CRYPTO: 'CRYPTO',
  COIN: 'CRYPTO',
  COINS: 'CRYPTO',
  AEX: 'AEX',
  DAX: 'DAX',
  DOWJONES: 'DOWJONES',
  'DOW JONES': 'DOWJONES',
  DOW_JONES: 'DOWJONES',
  ETFS: 'ETFS',
  ETFSCORE: 'ETFS',
  FTSE100: 'FTSE100',
  'FTSE 100': 'FTSE100',
  FTSE_100: 'FTSE100',
  HANGSENG: 'HANGSENG',
  'HANG SENG': 'HANGSENG',
  HANG_SENG: 'HANGSENG',
  NASDAQ: 'NASDAQ',
  NIKKEI225: 'NIKKEI225',
  'NIKKEI 225': 'NIKKEI225',
  NIKKEI_225: 'NIKKEI225',
  SENSEX: 'SENSEX',
  SP500: 'SP500',
  'S&P500': 'SP500',
  'S&P 500': 'SP500',
  S_P_500: 'SP500',
}

const MODE_ALIASES: Record<string, ScoreMode> = {
  STANDARD: 'STANDARD',
  NORMAL: 'STANDARD',
  STD: 'STANDARD',
  HIGH_CONF: 'HIGH_CONF',
  HIGHCONF: 'HIGH_CONF',
  HIGH: 'HIGH_CONF',
  HC: 'HIGH_CONF',
}

export function normalizeScoreMarket(input?: string | ScoreMarket | null): ScoreMarket | null {
  if (!input) return null
  const raw = String(input).trim().toUpperCase()
  if (!raw) return null
  if (MARKET_ALIASES[raw]) return MARKET_ALIASES[raw]
  const normalized = raw.replace(/[^\w& ]+/g, '').replace(/\s+/g, ' ').trim()
  if (MARKET_ALIASES[normalized]) return MARKET_ALIASES[normalized]
  return null
}

export function normalizeScoreMode(input?: string | ScoreMode | null): ScoreMode {
  if (!input) return 'STANDARD'
  const raw = String(input).trim().toUpperCase()
  if (!raw) return 'STANDARD'
  return MODE_ALIASES[raw] ?? 'STANDARD'
}

const weightFor = (market: ScoreMarket, key: WeightKey) =>
  BASE_WEIGHTS[key] * (MARKET_PROFILES[market].weightMult?.[key] ?? 1)

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
  // Trend (nieuw): 20d / 60d return + positie in 20d range + trend efficiency
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
}, ctx?: { market?: string | ScoreMarket | null; mode?: string | ScoreMode | null }): { score: number; status: Status; confidence: number; market: ScoreMarket; mode: ScoreMode } {
  const market = normalizeScoreMarket(ctx?.market) ?? 'DEFAULT'
  const mode = normalizeScoreMode(ctx?.mode)
  const profile = MARKET_PROFILES[market]

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

  // --- Trend (18%) — ret20 + ret60 + range-pos20 + trend efficiency
  let trendScore = 50
  let hasTrend = false
  const ret5 = ind.trend?.ret5
  const ret20 = ind.trend?.ret20
  const ret60 = ind.trend?.ret60
  const rangePos20 = ind.trend?.rangePos20
  const rangePos55 = ind.trend?.rangePos55
  const efficiency14 = ind.trend?.efficiency14
  const breakout20 = ind.trend?.breakout20
  const breakout55 = ind.trend?.breakout55
  const stretch20 = ind.trend?.stretch20
  if (
    typeof ret5 === 'number' ||
    typeof ret20 === 'number' ||
    typeof ret60 === 'number' ||
    typeof rangePos20 === 'number' ||
    typeof rangePos55 === 'number' ||
    typeof efficiency14 === 'number' ||
    typeof breakout20 === 'number' ||
    typeof breakout55 === 'number' ||
    typeof stretch20 === 'number'
  ) {
    hasTrend = true
    const mShort = typeof ret5 === 'number'
      ? clamp(ret5 / Math.max(1e-9, AGGR.trend.retRefPct * 0.34), -1, 1)
      : 0
    const m = typeof ret20 === 'number'
      ? clamp(ret20 / Math.max(1e-9, AGGR.trend.retRefPct), -1, 1)
      : 0
    const mLong = typeof ret60 === 'number'
      ? clamp(ret60 / Math.max(1e-9, AGGR.trend.retRefPct * 2.6), -1, 1)
      : 0
    const p = typeof rangePos20 === 'number'
      ? clamp((rangePos20 - 0.5) * 2, -1, 1)
      : 0
    const pLong = typeof rangePos55 === 'number'
      ? clamp((rangePos55 - 0.5) * 2, -1, 1)
      : 0
    const e = typeof efficiency14 === 'number'
      ? clamp((efficiency14 - 0.35) / 0.45, -1, 1)
      : 0
    const bo20 = typeof breakout20 === 'number' ? clamp(breakout20, -1, 1) : 0
    const bo55 = typeof breakout55 === 'number' ? clamp(breakout55, -1, 1) : 0
    const rawMix =
      0.20 * mShort +
      0.22 * m +
      0.12 * mLong +
      0.10 * p +
      0.08 * pLong +
      0.14 * bo20 +
      0.06 * bo55 +
      0.08 * e
    const stretchPenalty = typeof stretch20 === 'number'
      ? clamp((Math.abs(stretch20) - 6) / 10, 0, 1)
      : 0
    const mix = clamp(rawMix * (1 - 0.30 * stretchPenalty), -1, 1)
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
  if (hasTrend && typeof breakout20 === 'number') {
    dirs.push(breakout20 > 0.15 ? 1 : breakout20 < -0.15 ? -1 : 0)
  }
  const nonZero = dirs.filter(d => d !== 0)
  if (nonZero.length >= 2) {
    hasConsensus = true
    const avgDir = nonZero.reduce((s, d) => s + d, 0) / nonZero.length // -1..1
    consensusScore = clamp(50 + avgDir * AGGR.consensus.gain, 0, 100)
  }

  const parts: Array<{ key: WeightKey; w: number; v: number }> = []
  if (hasMA) parts.push({ key: 'ma', w: weightFor(market, 'ma'), v: maScore })
  if (hasRSI) parts.push({ key: 'rsi', w: weightFor(market, 'rsi'), v: rsiScore })
  if (hasMACD) parts.push({ key: 'macd', w: weightFor(market, 'macd'), v: macdScore })
  if (hasVOL) parts.push({ key: 'vol', w: weightFor(market, 'vol'), v: volScore })
  if (hasTrend) parts.push({ key: 'trend', w: weightFor(market, 'trend'), v: trendScore })
  if (hasVolReg) parts.push({ key: 'volReg', w: weightFor(market, 'volReg'), v: volRegScore })
  if (hasConsensus) parts.push({ key: 'consensus', w: weightFor(market, 'consensus'), v: consensusScore })

  if (!parts.length) return { score: 50, status: 'HOLD', confidence: 0, market, mode }

  const wSum = parts.reduce((s, p) => s + p.w, 0)
  const rawScore = parts.reduce((s, p) => s + p.v * (p.w / Math.max(1e-9, wSum)), 0)

  const maxWeight = (Object.keys(BASE_WEIGHTS) as WeightKey[]).reduce((s, k) => s + weightFor(market, k), 0)
  const coverage = clamp(wSum / Math.max(1e-9, maxWeight), 0, 1)

  const directional = parts.map(p => ({
    w: p.w,
    dir: clamp((p.v - 50) / 50, -1, 1),
  }))
  const signed = directional.reduce((s, p) => s + p.w * p.dir, 0)
  const absSigned = directional.reduce((s, p) => s + p.w * Math.abs(p.dir), 0)
  const alignment = absSigned > 1e-9 ? clamp(Math.abs(signed) / absSigned, 0, 1) : 0
  const strength = wSum > 1e-9 ? clamp(absSigned / wSum, 0, 1) : 0
  const confidence = clamp(0.45 * coverage + 0.30 * strength + 0.25 * alignment, 0, 1)

  const score = Math.round(clamp(rawScore, 0, 100))

  let { buy, sell, minConfidence } = profile.thresholds
  if (mode === 'HIGH_CONF') {
    buy = Math.min(90, buy + 4)
    sell = Math.max(10, sell - 4)
    minConfidence = Math.min(0.92, minConfidence + 0.12)
  }
  const softMin = Math.max(0.45, minConfidence - (mode === 'HIGH_CONF' ? 0.06 : 0.08))

  let status: Status = 'HOLD'
  if (score >= buy && confidence >= minConfidence) status = 'BUY'
  else if (score <= sell && confidence >= minConfidence) status = 'SELL'
  else if (score >= buy + 12 && confidence >= softMin) status = 'BUY'
  else if (score <= sell - 12 && confidence >= softMin) status = 'SELL'

  return { score, status, confidence, market, mode }
}
