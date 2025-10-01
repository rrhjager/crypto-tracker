// src/lib/score.ts
export type Advice = 'BUY' | 'HOLD' | 'SELL'

export type MaCrossResp = { symbol: string; ma50: number | null; ma200: number | null; status: Advice; points: number }
export type RsiResp    = { symbol: string; period: number; rsi: number | null; status: Advice; points: number }
export type MacdResp   = { symbol: string; fast: number; slow: number; signalPeriod: number; macd: number | null; signal: number | null; hist: number | null; status: Advice; points: number }
export type Vol20Resp  = { symbol: string; period: number; volume: number | null; avg20: number | null; ratio: number | null; status: Advice; points: number }

export function scoreToPct(s: number) {
  return Math.max(0, Math.min(100, Math.round(s)))
}
export function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

/** Zelfde aggregatie als op de detail- en lijstpagina’s */
export function computeCompositeScore(
  ma: MaCrossResp | null,
  macd: MacdResp | null,
  rsi: RsiResp | null,
  vol: Vol20Resp | null
): number {
  const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
  const toPts = (status?: Advice, pts?: number | null) => {
    if (Number.isFinite(pts as number)) return clamp(Number(pts), -2, 2)
    if (status === 'BUY')  return  2
    if (status === 'SELL') return -2
    return 0
  }

  const W_MA   = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
  const pMA    = toPts(ma?.status,   ma?.points)
  const pMACD  = toPts(macd?.status, macd?.points)
  const pRSI   = toPts(rsi?.status,  rsi?.points)
  const pVOL   = toPts(vol?.status,  vol?.points)

  const nMA    = (pMA   + 2) / 4
  const nMACD  = (pMACD + 2) / 4
  const nRSI   = (pRSI  + 2) / 4
  const nVOL   = (pVOL  + 2) / 4

  const agg = W_MA*nMA + W_MACD*nMACD + W_RSI*nRSI + W_VOL*nVOL
  return scoreToPct(agg * 100)
}