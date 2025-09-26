// src/lib/advise.ts
export type MaCross = { ma50: number | null; ma200: number | null }
export type Macd    = { macd: number | null; signal: number | null }
export type Rsi     = { rsi: number | null }
export type Vol20   = { ratio: number | null } // volume / avg20

export type Advice = 'BUY' | 'HOLD' | 'SELL'
export type AdviceResult = {
  score: number
  advice: Advice
  reasons: string[]
  parts: { name: string; weight: number }[]
  confidence: number // 0..100, hoeveel van het model konden we toepassen
}

export function computeAdvice(
  ma: MaCross | null,
  macd: Macd | null,
  rsi: Rsi | null,
  vol: Vol20 | null
): AdviceResult {
  let score = 0
  const parts: { name: string; weight: number }[] = []
  const reasons: string[] = []
  let present = 0, presentMax = 0

  // MA50/200 – zwaar
  presentMax += 2
  if (ma && isNum(ma.ma50) && isNum(ma.ma200)) {
    present += 2
    if ((ma.ma50 as number) > (ma.ma200 as number)) {
      score += 2; parts.push({ name: 'MA50>MA200', weight: +2 }); reasons.push('MA50>MA200 (uptrend)')
    } else if ((ma.ma50 as number) < (ma.ma200 as number)) {
      score -= 2; parts.push({ name: 'MA50<MA200', weight: -2 }); reasons.push('MA50<MA200 (downtrend)')
    } else {
      parts.push({ name: 'MA vlak', weight: 0 })
    }
  }

  // MACD – momentum
  presentMax += 1
  if (macd && isNum(macd.macd) && isNum(macd.signal)) {
    present += 1
    if ((macd.macd as number) > (macd.signal as number)) {
      score += 1; parts.push({ name: 'MACD>Signaal', weight: +1 }); reasons.push('Positief momentum')
    } else if ((macd.macd as number) < (macd.signal as number)) {
      score -= 1; parts.push({ name: 'MACD<Signaal', weight: -1 }); reasons.push('Negatief momentum')
    } else {
      parts.push({ name: 'MACD gelijk', weight: 0 })
    }
  }

  // RSI – conditie
  presentMax += 0.5
  if (rsi && isNum(rsi.rsi)) {
    present += 0.5
    const v = rsi.rsi as number
    if (v >= 45 && v <= 70) {
      score += 0.5; parts.push({ name: 'RSI 45–70', weight: +0.5 }); reasons.push('Gezonde trend (RSI 45–70)')
    } else if (v > 70) {
      score -= 0.5; parts.push({ name: 'RSI>70', weight: -0.5 }); reasons.push('Overbought')
    } else if (v < 30) {
      score -= 0.5; parts.push({ name: 'RSI<30', weight: -0.5 }); reasons.push('Zwak')
    } else {
      parts.push({ name: 'RSI neutraal', weight: 0 })
    }
  }

  // Volume vs 20d – validatie
  presentMax += 0.5
  if (vol && isNum(vol.ratio)) {
    present += 0.5
    const r = vol.ratio as number
    if (r >= 1.5) {
      score += 0.5; parts.push({ name: 'Volume ≥1.5×', weight: +0.5 }); reasons.push('Volume boven 20d')
    } else if (r <= 0.7) {
      score -= 0.5; parts.push({ name: 'Volume ≤0.7×', weight: -0.5 }); reasons.push('Volume onder 20d')
    } else {
      parts.push({ name: 'Volume normaal', weight: 0 })
    }
  }

  let advice: Advice = 'HOLD'
  if (score >= 2) advice = 'BUY'
  else if (score <= -1.5) advice = 'SELL'

  const confidence = Math.round(100 * clamp01(present / Math.max(0.0001, presentMax)))
  return { score: round(score, 2), advice, reasons, parts, confidence }
}

function isNum(v: any): v is number { return Number.isFinite(Number(v)) }
function clamp01(x: number) { return Math.max(0, Math.min(1, x)) }
function round(x: number, d = 2) { const m = 10**d; return Math.round((x + Number.EPSILON) * m) / m }