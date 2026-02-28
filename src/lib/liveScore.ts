import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { computeScoreStatus, normalizeScoreMode } from '@/lib/taScore'
import { resolveScoreMarket } from '@/lib/marketResolver'
import { getBenchmarkSpec } from '@/lib/benchmarkSymbols'
import { sma, rsi as rsiWilder, macd as macdCalc, avgVolume } from '@/lib/ta-light'
import { latestRangeStrengthFeatures, latestRelativeStrengthFeatures, latestTrendFeatures, latestVolatilityFeatures } from '@/lib/taExtras'

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

function normHighs(ohlc: any): number[] {
  if (Array.isArray(ohlc)) return []
  if (ohlc && Array.isArray(ohlc.highs)) {
    return (ohlc.highs as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray(ohlc.h)) {
    return (ohlc.h as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  return []
}

function normLows(ohlc: any): number[] {
  if (Array.isArray(ohlc)) return []
  if (ohlc && Array.isArray(ohlc.lows)) {
    return (ohlc.lows as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  if (ohlc && Array.isArray(ohlc.l)) {
    return (ohlc.l as any[]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  }
  return []
}

export async function computeLiveScore(symbol: string, marketHint?: string, modeHint?: string): Promise<LiveScoreResp> {
  const market = resolveScoreMarket(marketHint, symbol, 'DEFAULT')
  const ohlc = await getYahooDailyOHLC(symbol, '1y')
  const closes = normCloses(ohlc)
  const highs = normHighs(ohlc)
  const lows = normLows(ohlc)
  const vols = normVolumes(ohlc)

  let benchmarkCloses: number[] | null = null
  const benchmark = getBenchmarkSpec(market)
  if (benchmark?.kind === 'equity') {
    try {
      benchmarkCloses = normCloses(await getYahooDailyOHLC(benchmark.symbol, '1y'))
    } catch {
      benchmarkCloses = null
    }
  } else if (market === 'CRYPTO') {
    try {
      benchmarkCloses = normCloses(await getYahooDailyOHLC('BTC-USD', '1y'))
    } catch {
      benchmarkCloses = null
    }
  }

  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)
  const rsi = rsiWilder(closes, 14)
  const m = macdCalc(closes, 12, 26, 9)
  const hist = m?.hist ?? null
  const volNow = vols.length ? vols.at(-1)! : null
  const avg20d = avgVolume(vols, 20)
  const ratio = typeof volNow === 'number' && typeof avg20d === 'number' && avg20d > 0 ? volNow / avg20d : null
  const trendBase = latestTrendFeatures(closes, 20)
  const relStrength = latestRelativeStrengthFeatures(closes, benchmarkCloses)
  const rangeStrength = latestRangeStrengthFeatures(highs, lows, closes)
  const trend = {
    ...trendBase,
    adx14: rangeStrength.adx14,
    relBench20: relStrength.relBench20,
    relBench60: relStrength.relBench60,
  }
  const volatility = {
    ...latestVolatilityFeatures(closes, 20),
    atrPct14: rangeStrength.atrPct14,
  }

  const overall = computeScoreStatus(
    {
      ma: { ma50: ma50 ?? null, ma200: ma200 ?? null },
      rsi: rsi ?? null,
      macd: { hist },
      volume: { ratio },
      trend,
      volatility,
    },
    { market, mode: normalizeScoreMode(modeHint) }
  )

  const scoreRaw = typeof overall.score === 'number' && Number.isFinite(overall.score) ? overall.score : 50
  const score = Math.round(scoreRaw)

  return {
    symbol,
    score,
    status: overall.status as Advice,
  }
}
