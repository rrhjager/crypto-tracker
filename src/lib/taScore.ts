// src/lib/taScore.ts
export type Status = 'BUY' | 'HOLD' | 'SELL'

export type MAStruct    = { ma50: number | null; ma200: number | null }
export type MACDStruct  = { hist: number | null }
export type VolumeStruct= { ratio: number | null }

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
  vol: { gain: 45 } // was ~50±30 → nu ±45
}

/**
 * Eén bron van waarheid voor de score (homepage, overzicht, detail).
 * Weging: MA 35% · RSI 25% · MACD 25% · Volume 15%
 */
export function computeScoreStatus(ind: {
  ma?: MAStruct | null
  rsi?: number | null
  macd?: MACDStruct | null
  volume?: VolumeStruct | null
}): { score: number; status: Status } {
  // --- MA (35%)
  let maScore = 50
  if (ind.ma?.ma50 != null && ind.ma?.ma200 != null) {
    const { ma50, ma200 } = ind.ma
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

  // --- RSI (25%) — contrarian (oversold = bullish, overbought = bearish)
  let rsiScore = 50
  if (typeof ind.rsi === 'number') {
    // ✅ fix: de oude mapping draaide RSI om (hoog RSI werd bullish).
    // We willen:
    // - RSI ≤ 30  => bullish => 100
    // - RSI = 50  => neutraal => 50
    // - RSI ≥ 70  => bearish => 0
    const base = clamp(((70 - ind.rsi) / 40) * 100, 0, 100) // 30..70 → 100..0
    // aggressiever: boost afstand tot 50
    const delta = (base - 50) * AGGR.rsi.gamma
    rsiScore = clamp(50 + delta, 0, 100)
  }

  // --- MACD (25%) — normaliseer hist t.o.v. MA50
  let macdScore = 50
  const hist = ind.macd?.hist
  const ref = ind.ma?.ma50 ?? null
  if (typeof hist === 'number') {
    if (ref && ref > 0) {
      // rel = (hist/ma50)/ref → clamp -1..1 → 50 ± scale*rel
      const rel = clamp((hist / ref) / Math.max(1e-9, AGGR.macd.ref), -1, 1)
      macdScore = clamp(50 + rel * AGGR.macd.scale, 0, 100)
    } else {
      macdScore = hist > 0 ? 65 : hist < 0 ? 35 : 50 // iets agressiever dan 60/40
    }
  }

  // --- Volume (15%) — ratio rond 1.0
  let volScore = 50
  const ratio = ind.volume?.ratio
  if (typeof ratio === 'number') {
    // delta (±1) → 50 ± gain
    const delta = clamp(ratio - 1, -1, 1)
    volScore = clamp(50 + delta * AGGR.vol.gain, 0, 100)
  }

  const score = Math.round(
    clamp(0.35 * maScore + 0.25 * rsiScore + 0.25 * macdScore + 0.15 * volScore, 0, 100)
  )
  return { score, status: statusFromScore(score) }
}