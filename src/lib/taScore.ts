// src/lib/taScore.ts
export type Advice = 'BUY' | 'HOLD' | 'SELL'

export function computeScoreStatus(input: {
  ma?: { ma50: number | null; ma200: number | null }
  rsi?: number | null
  macd?: { hist: number | null }
  volume?: { ratio: number | null }
}): { score: number; status: Advice } {
  // weights add to 1.00
  const W_MA = 0.35
  const W_RSI = 0.25
  const W_MACD = 0.25
  const W_VOL = 0.15

  // smooth pull-away from 50
  const GAMMA = 0.9

  // --- MA score ---
  // 0..100 from relative MA50 vs MA200 (trend)
  let maScore = 50
  const ma50 = input.ma?.ma50
  const ma200 = input.ma?.ma200
  if (Number.isFinite(ma50 as number) && Number.isFinite(ma200 as number) && (ma200 as number) > 0) {
    const ratio = (ma50 as number) / (ma200 as number)
    // map ratio 0.95..1.05 => 0..100 (clamped)
    const x = Math.max(0, Math.min(1, (ratio - 0.95) / 0.10))
    maScore = x * 100
    maScore = maScore >= 50 ? 50 + (maScore - 50) * GAMMA : 50 - (50 - maScore) * GAMMA
  }

  // --- RSI score ---
  // ✅ INVERTED RSI: low RSI is bullish, high RSI is bearish.
  // We map RSI 30..70 => 0..100, then flip to 100..0.
  let rsiScore = 50
  const rsi = input.rsi
  if (Number.isFinite(rsi as number)) {
    const x = Math.max(0, Math.min(1, ((rsi as number) - 30) / 40)) // 30..70 => 0..1
    let base = x * 100 // 0..100
    base = 100 - base // ✅ flip
    rsiScore = base >= 50 ? 50 + (base - 50) * GAMMA : 50 - (50 - base) * GAMMA
  }

  // --- MACD hist score ---
  // hist positive => bullish, negative => bearish
  let macdScore = 50
  const hist = input.macd?.hist
  if (Number.isFinite(hist as number)) {
    // squash hist with tanh-ish clamp
    const h = Math.max(-1, Math.min(1, (hist as number) / 0.02)) // scale factor
    macdScore = (h + 1) * 50
    macdScore = macdScore >= 50 ? 50 + (macdScore - 50) * GAMMA : 50 - (50 - macdScore) * GAMMA
  }

  // --- Volume ratio score ---
  // ratio > 1 helps bullish conviction a bit; < 1 hurts a bit
  let volScore = 50
  const ratio = input.volume?.ratio
  if (Number.isFinite(ratio as number)) {
    const r = ratio as number
    // map 0.5..1.5 => 0..100
    const x = Math.max(0, Math.min(1, (r - 0.5) / 1.0))
    volScore = x * 100
    volScore = volScore >= 50 ? 50 + (volScore - 50) * GAMMA : 50 - (50 - volScore) * GAMMA
  }

  // weighted score
  let score =
    maScore * W_MA +
    rsiScore * W_RSI +
    macdScore * W_MACD +
    volScore * W_VOL

  score = Math.max(0, Math.min(100, score))
  const status: Advice = score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD'

  return { score: Math.round(score), status }
}