// src/lib/pastPerformance/indicatorsExact.ts
// Equities "exact" indicators: same Yahoo daily source + same ta-light functions as /api/indicators/snapshot.ts

import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { sma, rsi as rsiWilder, macd as macdTa, avgVolume } from '@/lib/ta-light'

export type MarketData = {
  times: number[]   // unix seconds (Yahoo timestamps)
  closes: number[]
  volumes: number[]
}

export type MarketDataResult =
  | { ok: true; data: MarketData; source: string }
  | { ok: false; error: string }

export async function fetchMarketDataFor(
  symbol: string,
  opts?: { range?: '1y' | '2y'; limit?: number }
): Promise<MarketDataResult> {
  try {
    const range = opts?.range ?? '2y'
    const limit = opts?.limit ?? 900

    const { timestamps, close, volume } = await getYahooDailyOHLC(symbol, range, limit)

    const n = Math.min(timestamps.length, close.length, volume.length)
    if (n < 260) {
      return { ok: false, error: 'Not enough daily history' }
    }

    // Ensure numeric arrays
    const times: number[] = []
    const closes: number[] = []
    const volumes: number[] = []

    for (let i = 0; i < n; i++) {
      const c = close[i]
      const v = volume[i]
      const t = timestamps[i]
      if (!Number.isFinite(t) || !Number.isFinite(c)) continue
      times.push(t)
      closes.push(c)
      volumes.push(Number.isFinite(v) ? v : 0)
    }

    if (closes.length < 260) {
      return { ok: false, error: 'Not enough daily history (after filtering)' }
    }

    return {
      ok: true,
      source: `yahoo:${range}`,
      data: { times, closes, volumes },
    }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
}

export function computeIndicators(closes: number[], volumes: number[]) {
  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)

  const rsi14 = rsiWilder(closes, 14)

  const m = macdTa(closes, 12, 26, 9)
  const hist = m?.hist ?? null
  const macd = m?.macd ?? null
  const signal = m?.signal ?? null

  const avg20d = avgVolume(volumes, 20)
  const lastVol = volumes.length ? volumes[volumes.length - 1] : null
  const ratio =
    lastVol != null && avg20d != null && Number.isFinite(lastVol) && Number.isFinite(avg20d) && avg20d !== 0
      ? lastVol / avg20d
      : null

  return {
    ma: { ma50, ma200 },
    rsi: rsi14,
    macd: { macd, signal, hist },
    volume: { avg20d, volume: lastVol, ratio },
  }
}