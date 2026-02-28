// src/pages/api/indicators/score/[symbol].ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'
import { normalizeScoreMode } from '@/lib/taScore'
import { resolveScoreMarket } from '@/lib/marketResolver'
import { computeLiveScore, type Advice, type LiveScoreResp } from '@/lib/liveScore'

export const config = { runtime: 'nodejs' }

const TTL_SEC = 300
const SCORE_VER = 'v2'
type ScoreResp = LiveScoreResp

function isAdvice(x: any): x is Advice {
  return x === 'BUY' || x === 'HOLD' || x === 'SELL'
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
    const computed = await computeLiveScore(symbol, resolvedMarket, resolvedMode)

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
