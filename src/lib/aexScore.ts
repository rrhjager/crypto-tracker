// src/lib/aexScore.ts
export type Advice = 'BUY' | 'HOLD' | 'SELL'

export type AexInputs = {
  ma50: number | null
  ma200: number | null
  macd: number | null
  signal: number | null
  hist?: number | null        // optioneel: MACD histogram (laatste bar)
  prevHist?: number | null    // optioneel: vorige histogrambar (voor momentum)
  rsi: number | null
  volRatio: number | null     // huidige volume / 20-daags gemiddelde
  price?: number | null       // optioneel, voor “near” check bij MACD
}

export function scoreAEX(i: AexInputs) {
  // Gewichten
  const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10

  // --- MA (-2..+2)
  let pMA = 0
  if (Number.isFinite(i.ma50 as number) && Number.isFinite(i.ma200 as number)) {
    const diff = (i.ma50! - i.ma200!) / Math.max(1e-9, i.ma200!)
    const ad = Math.abs(diff)
    const near = ad < 0.003 // 0.3%
    if (diff > 0) pMA = near ? +1 : +2
    else if (diff < 0) pMA = near ? -1 : -2
  }

  // --- MACD (-2..+2)
  let pMACD = 0
  if (Number.isFinite(i.macd as number) && Number.isFinite(i.signal as number)) {
    const delta = i.macd! - i.signal!
    const near = i.price && Math.abs(delta) < (0.001 * i.price)
    const haveHist = Number.isFinite(i.hist as number) && Number.isFinite(i.prevHist as number)
    const histUp = haveHist ? (i!.hist! > i!.prevHist!) : false
    const histDown = haveHist ? (i!.hist! < i!.prevHist!) : false

    if (near) pMACD = 0
    else if (delta > 0) pMACD = histUp ? +2 : +1
    else if (delta < 0) pMACD = histDown ? -2 : -1
  }

  // --- RSI (-2..+2)
  let pRSI = 0
  if (Number.isFinite(i.rsi as number)) {
    const r = i.rsi!
    if (r >= 50 && r <= 65) pRSI = +2
    else if ((r >= 45 && r < 50) || (r > 65 && r <= 70)) pRSI = +1
    else if (r >= 40 && r < 45) pRSI = 0
    else if ((r >= 30 && r < 40) || (r > 70 && r <= 75)) pRSI = -1
    else if (r < 30 || r > 75) pRSI = -2
  }

  // --- Volume (-2..+2)
  let pVOL = 0
  if (Number.isFinite(i.volRatio as number)) {
    const v = i.volRatio!
    if (v >= 1.8) pVOL = +2
    else if (v >= 1.3) pVOL = +1
    else if (v > 0.7) pVOL = 0
    else if (v > 0.5) pVOL = -1
    else pVOL = -2
  }

  // Gewogen som -> 0..100
  const W = (W_MA*pMA) + (W_MACD*pMACD) + (W_RSI*pRSI) + (W_VOL*pVOL) // ∈ [-2..+2]
  const score = Math.round(((W + 2) / 4) * 100)
  const status: Advice = score >= 66 ? 'BUY' : (score <= 33 ? 'SELL' : 'HOLD')

  return {
    status,
    score,
    breakdown: {
      ma: { points: pMA, weight: W_MA },
      macd: { points: pMACD, weight: W_MACD },
      rsi: { points: pRSI, weight: W_RSI },
      volume: { points: pVOL, weight: W_VOL },
    }
  }
}