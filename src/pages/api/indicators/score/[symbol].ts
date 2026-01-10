// src/pages/api/indicators/score/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'

import { computeScoreStatus } from '@/lib/taScore'
import { sma, rsi as rsiWilder, macd as macdCalc, avgVolume } from '@/lib/ta-light'

export const config = { runtime: 'nodejs' }

const TTL_SEC = 300
const RANGE: '1y' | '2y' = '1y'

type Bar = { close?: number; c?: number; volume?: number; v?: number }

type ScoreResp = {
  symbol: string
  score: number | null
  status?: 'BUY' | 'HOLD' | 'SELL'
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

async function computeScore(symbol: string): Promise<ScoreResp> {
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

  const overall = computeScoreStatus({
    ma: { ma50: ma50 ?? null, ma200: ma200 ?? null },
    rsi: rsi ?? null,
    macd: { hist },
    volume: { ratio },
  })

  return {
    symbol,
    score: Number.isFinite(overall.score) ? overall.score : 50,
    status: overall.status,
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ScoreResp | { error: string }>
) {
  try {
    const symbol = String(req.query.symbol || '').toUpperCase().trim()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    // Als je snapshot.ts dit al opslaat, kunnen we KV hergebruiken
    const kvKey = `ind:snap:all:${symbol}`

    try {
      const snap = await kvGetJSON<any>(kvKey)
      const fresh = snap && typeof snap.updatedAt === 'number' && (Date.now() - snap.updatedAt) < TTL_SEC * 1000
      const cachedScore = snap?.value?.score
      const cachedStatus = snap?.value?.status
      if (fresh && Number.isFinite(cachedScore)) {
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120')
        return res.status(200).json({
          symbol,
          score: Math.round(Number(cachedScore)),
          status: cachedStatus,
        })
      }
    } catch {}

    const computed = await computeScore(symbol)

    // Schrijf terug zodat detailpagina's en lijsten dezelfde bron kunnen gebruiken
    try {
      await kvSetJSON(
        kvKey,
        { updatedAt: Date.now(), value: { score: computed.score, status: computed.status } },
        TTL_SEC
      )
    } catch {}

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120')
    return res.status(200).json(computed)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}