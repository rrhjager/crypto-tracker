// src/lib/taScore.ts
export type Status = 'BUY' | 'HOLD' | 'SELL'

export type MAStruct = { ma50: number | null; ma200: number | null }
export type MACDStruct = { hist: number | null }
export type VolumeStruct = { ratio: number | null }

export function statusFromScore(score: number): Status {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

/**
 * Agressievere variant van de oude scoreberekening.
 * Zelfde interface, dus werkt overal 1-op-1 door.
 *
 * Wegingen: MA 45% · MACD 30% · RSI 15% · Volume 10%
 * - MA: asymmetrisch (bulls iets zwaarder beloond, bears harder afgestraft)
 * - MACD: ±30 band, lagere gevoeligheidsdrempel (0.005)
 * - RSI: steiler rond neutraal, dus <45 → duidelijk negatief, >55 → positief
 * - Volume: extra bonus/malus voor ratio >1.5 of <0.8
 */
export function computeScoreStatus(ind: {
  ma?: MAStruct | null
  rsi?: number | null
  macd?: MACDStruct | null
  volume?: VolumeStruct | null
}): { score: number; status: Status } {
  // 1️⃣ MA (45%)
  let maScore = 50
  if (ind.ma?.ma50 != null && ind.ma?.ma200 != null) {
    const m50 = ind.ma.ma50
    const m200 = ind.ma.ma200
    if (m50 > m200) {
      const spread = clamp(m50 / Math.max(1e-9, m200) - 1, 0, 0.25)
      // Bull: basis 65 → max 95
      maScore = Math.min(95, 65 + (spread / 0.25) * 30)
    } else {
      const spread = clamp(m200 / Math.max(1e-9, m50) - 1, 0, 0.25)
      // Bear: basis 35 → min 15
      maScore = Math.max(15, 35 - (spread / 0.25) * 20)
    }
  }

  // 2️⃣ RSI (15%)
  let rsiScore = 50
  if (typeof ind.rsi === 'number') {
    const r = ind.rsi
    if (r <= 30) rsiScore = 30
    else if (r >= 70) rsiScore = 70
    else if (r < 50) rsiScore = 50 - (50 - r) * 1.2 // steiler omlaag
    else rsiScore = 50 + (r - 50) * 1.0
    rsiScore = clamp(rsiScore, 0, 100)
  }

  // 3️⃣ MACD (30%)
  let macdScore = 50
  if (typeof ind.macd?.hist === 'number') {
    const hist = ind.macd.hist
    const t = 0.005 // agressiever
    const rel = clamp(hist / t, -1, 1)
    macdScore = Math.round(50 + rel * 30) // ±30 band
  }

  // 4️⃣ Volume (10%)
  let volScore = 50
  if (typeof ind.volume?.ratio === 'number') {
    const ratio = ind.volume.ratio
    const base = clamp(50 + ((ratio - 1) / 1) * 30, 0, 100)
    const bonus = ratio > 1.5 ? 10 : ratio < 0.8 ? -10 : 0
    volScore = clamp(base + bonus, 0, 100)
  }

  // 📊 Weging + output
  const score = Math.round(
    clamp(0.45 * maScore + 0.30 * macdScore + 0.15 * rsiScore + 0.10 * volScore, 0, 100)
  )

  return { score, status: statusFromScore(score) }
}