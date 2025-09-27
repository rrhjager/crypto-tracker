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
 * Exact dezelfde weging als op je detailpagina:
 * MA 35% · RSI 25% · MACD 25% · Volume 15%
 *
 * Input is “plat” zodat je dit op zowel server als client makkelijk kunt aanroepen.
 */
export function computeScoreStatus(ind: {
  ma?: MAStruct | null
  rsi?: number | null
  macd?: MACDStruct | null
  volume?: VolumeStruct | null
}): { score: number; status: Status } {
  // MA (35%)
  let maScore = 50
  if (ind.ma?.ma50 != null && ind.ma?.ma200 != null) {
    if (ind.ma.ma50 > ind.ma.ma200) {
      const spread = clamp(ind.ma.ma50 / Math.max(1e-9, ind.ma.ma200) - 1, 0, 0.2)
      maScore = 60 + (spread / 0.2) * 40
    } else if (ind.ma.ma50 < ind.ma.ma200) {
      const spread = clamp(ind.ma.ma200 / Math.max(1e-9, ind.ma.ma50) - 1, 0, 0.2)
      maScore = 40 - (spread / 0.2) * 40
    }
  }

  // RSI (25%) — 30..70 mappen naar 0..100
  let rsiScore = 50
  if (typeof ind.rsi === 'number') {
    rsiScore = clamp(((ind.rsi - 30) / 40) * 100, 0, 100)
  }

  // MACD (25%) — histogram > 0 bullish
  let macdScore = 50
  if (typeof ind.macd?.hist === 'number') {
    macdScore = ind.macd.hist > 0 ? 70 : ind.macd.hist < 0 ? 30 : 50
  }

  // Volume (15%) — ratio > 1 bullish
  let volScore = 50
  if (typeof ind.volume?.ratio === 'number') {
    volScore = clamp((ind.volume.ratio / 2) * 100, 0, 100)
  }

  const score = Math.round(
    clamp(0.35 * maScore + 0.25 * rsiScore + 0.25 * macdScore + 0.15 * volScore, 0, 100)
  )
  return { score, status: statusFromScore(score) }
}