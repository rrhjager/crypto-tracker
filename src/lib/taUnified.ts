// src/lib/taUnified.ts
// One shared place for indicator calculations (crypto + equities, list + detail)

import { sma, rsi as rsiWilder, macd as macdCalc, avgVolume } from '@/lib/ta-light'

export type TAIndicators = {
  ma: { ma50: number | null; ma200: number | null; cross: 'Golden Cross' | 'Death Cross' | '—' }
  rsi: number | null
  macd: { macd: number | null; signal: number | null; hist: number | null }
  volume: { volume: number | null; avg20d: number | null; ratio: number | null }
}

export function computeTaIndicators(closes: number[], volumes: number[]): TAIndicators {
  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)

  const cross: TAIndicators['ma']['cross'] =
    ma50 != null && ma200 != null
      ? ma50 > ma200
        ? 'Golden Cross'
        : ma50 < ma200
          ? 'Death Cross'
          : '—'
      : '—'

  const rsi = rsiWilder(closes, 14)
  const macd = macdCalc(closes, 12, 26, 9)

  const volume = volumes.length ? (volumes.at(-1) ?? null) : null
  const avg20d = avgVolume(volumes, 20)
  const ratio =
    typeof volume === 'number' && typeof avg20d === 'number' && avg20d > 0 ? volume / avg20d : null

  return {
    ma: { ma50, ma200, cross },
    rsi,
    macd: { macd: macd.macd ?? null, signal: macd.signal ?? null, hist: macd.hist ?? null },
    volume: { volume, avg20d: avg20d ?? null, ratio },
  }
}