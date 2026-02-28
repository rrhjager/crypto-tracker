import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { computeScoreStatus, normalizeScoreMode } from '@/lib/taScore'
import { resolveScoreMarket } from '@/lib/marketResolver'
import { sma, rsi as rsiWilder, macd as macdCalc, avgVolume } from '@/lib/ta-light'
import { latestTrendFeatures, latestVolatilityFeatures } from '@/lib/taExtras'

export type Advice = 'BUY' | 'HOLD' | 'SELL'

export type LiveScoreResp = {
  symbol: string
  score: number | null
  status?: Advice
}

type Bar = { close?: number; c?: number; volume?: number; v?: number }

function normCloses(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map((b) => (typeof b?.close === 'number' ? b.close : typeof b?.c === 'number' ? b.c : null))
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray(ohlc.closes)) {
    return (ohlc.closes as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray(ohlc.c)) {
    return (ohlc.c as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  return []
}

function normVolumes(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map((b) => (typeof b?.volume === 'number' ? b.volume : typeof b?.v === 'number' ? b.v : null))
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray(ohlc.volumes)) {
    return (ohlc.volumes as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray(ohlc.v)) {
    return (ohlc.v as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  return []
}

export async function computeLiveScore(symbol: string, marketHint?: string, modeHint?: string): Promise<LiveScoreResp> {
  const ohlc = await getYahooDailyOHLC(symbol, '1y')
  const closes = normCloses(ohlc)
  const vols = normVolumes(ohlc)

  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)
  const rsi = rsiWilder(closes, 14)
  const m = macdCalc(closes, 12, 26, 9)
  const hist = m?.hist ?? null
  const volNow = vols.length ? vols.at(-1)! : null
  const avg20d = avgVolume(vols, 20)
  const ratio = typeof volNow === 'number' && typeof avg20d === 'number' && avg20d > 0 ? volNow / avg20d : null
  const trend = latestTrendFeatures(closes, 20)
  const volatility = latestVolatilityFeatures(closes, 20)

  const overall = computeScoreStatus(
    {
      ma: { ma50: ma50 ?? null, ma200: ma200 ?? null },
      rsi: rsi ?? null,
      macd: { hist },
      volume: { ratio },
      trend,
      volatility,
    },
    { market: resolveScoreMarket(marketHint, symbol, 'DEFAULT'), mode: normalizeScoreMode(modeHint) }
  )

  const scoreRaw = typeof overall.score === 'number' && Number.isFinite(overall.score) ? overall.score : 50
  const score = Math.round(scoreRaw)

  return {
    symbol,
    score,
    status: overall.status as Advice,
  }
}
