// src/pages/api/indicators/score/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

import { computeScoreStatus, normalizeScoreMode } from '@/lib/taScore'
import { resolveScoreMarket } from '@/lib/marketResolver'
import { sma, rsi as rsiWilder, macd as macdCalc, avgVolume } from '@/lib/ta-light'
import { latestTrendFeatures, latestVolatilityFeatures } from '@/lib/taExtras'

export const config = { runtime: 'nodejs' }

const TTL_SEC = 300
const RANGE: '1y' | '2y' = '1y'
const SCORE_VER = 'v2'

type Advice = 'BUY' | 'HOLD' | 'SELL'
type Bar = { close?: number; c?: number; volume?: number; v?: number }

type ScoreResp = {
  symbol: string
  score: number | null
  status?: Advice
}

function isAdvice(x: any): x is Advice {
  return x === 'BUY' || x === 'HOLD' || x === 'SELL'
}

function normCloses(ohlc: any): number[] {
  if (Array.isArray(ohlc)) {
    return (ohlc as Bar[])
      .map(b => (typeof b?.close === 'number' ? b.close : typeof b?.c === 'number' ? b.c : null))
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
      .map(b => (typeof b?.volume === 'number' ? b.volume : typeof b?.v === 'number' ? b.v : null))
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

// ✅ 1-op-1 met crypto: computeScoreStatus({ ma, rsi, macd:{hist}, volume:{ratio} })
async function computeScore(symbol: string, marketHint?: string, modeHint?: string): Promise<ScoreResp> {
  const ohlc = await getYahooDailyOHLC(symbol, RANGE)
  const closes = normCloses(ohlc)
  const vols = normVolumes(ohlc)

  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)

  const rsi = rsiWilder(closes, 14)

  const m = macdCalc(closes, 12, 26, 9)
  const hist = m?.hist ?? null

  const volNow = vols.length ? vols.at(-1)! : null
  const avg20d = avgVolume(vols, 20)
  const ratio =
    typeof volNow === 'number' && typeof avg20d === 'number' && avg20d > 0 ? volNow / avg20d : null
  const trend = latestTrendFeatures(closes, 20)
  const volatility = latestVolatilityFeatures(closes, 20)

  const overall = computeScoreStatus({
    ma: { ma50: ma50 ?? null, ma200: ma200 ?? null },
    rsi: rsi ?? null,
    macd: { hist },
    volume: { ratio },
    trend,
    volatility,
  }, { market: resolveScoreMarket(marketHint, symbol, 'DEFAULT'), mode: modeHint })

  const scoreRaw = typeof overall.score === 'number' && Number.isFinite(overall.score) ? overall.score : 50
  const score = Math.round(scoreRaw)

  return {
    symbol,
    score,
    status: overall.status as Advice,
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ScoreResp | { error: string }>
) {
  try {
    const symbol = String(req.query.symbol || '').toUpperCase().trim()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })
    const marketHint = String(req.query.market || '').trim()
    const modeHint = String(req.query.mode || '').trim()
    const resolvedMarket = resolveScoreMarket(marketHint, symbol, 'DEFAULT')
    const resolvedMode = normalizeScoreMode(modeHint)

    // snapshot.ts gebruikt deze key ook voor “full snapshot”
    const kvKey = `ind:snap:all:${symbol}:${resolvedMarket}:${resolvedMode}`

    // 1) Probeer KV (als snapshot.ts al gerund heeft)
    try {
      const snap = await kvGetJSON<any>(kvKey)
      const fresh = snap && typeof snap.updatedAt === 'number' && (Date.now() - snap.updatedAt) < TTL_SEC * 1000
      const freshScoreVersion = snap?.value?.scoreVersion === SCORE_VER
      const freshScoreMarket = snap?.value?.scoreMarket === resolvedMarket
      const freshScoreMode = snap?.value?.scoreMode === resolvedMode
      const cachedScore = snap?.value?.score
      const cachedStatus = snap?.value?.status

      if (fresh && freshScoreVersion && freshScoreMarket && freshScoreMode && Number.isFinite(cachedScore)) {
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120')
        return res.status(200).json({
          symbol,
          score: Math.round(Number(cachedScore)),
          status: isAdvice(cachedStatus) ? cachedStatus : undefined,
        })
      }
    } catch {}

    // 2) Compute (zelfde scoring als crypto) + schrijf terug naar KV
    const computed = await computeScore(symbol, resolvedMarket, resolvedMode)

    try {
      // ✅ merge: behoud eventuele extra velden die snapshot.ts al had opgeslagen
      const existing = await kvGetJSON<any>(kvKey).catch(() => null)
      const nextValue =
        existing && typeof existing === 'object' && existing.value && typeof existing.value === 'object'
          ? { ...existing.value, score: computed.score, status: computed.status, scoreVersion: SCORE_VER, scoreMarket: resolvedMarket, scoreMode: resolvedMode }
          : { score: computed.score, status: computed.status, scoreVersion: SCORE_VER, scoreMarket: resolvedMarket, scoreMode: resolvedMode }

      await kvSetJSON(kvKey, { updatedAt: Date.now(), value: nextValue }, TTL_SEC)
    } catch {}

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120')
    return res.status(200).json(computed)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
