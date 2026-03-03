export const config = { runtime: 'nodejs', maxDuration: 60 }

import type { NextApiRequest, NextApiResponse } from 'next'
import { syncForwardTracker } from '@/lib/forwardTracker'

type SyncSummary = {
  sourceMode: string
  openTrades: number
  closedTrades: number
  totalPnlEur: number
  currentSignals: number
  lastSyncAt: string
}

type Resp = {
  ok: true
  ranAt: string
  equity: SyncSummary
  crypto: SyncSummary
  cryptoHighMove: SyncSummary
  cryptoHighMoveRelaxed: SyncSummary
  cryptoBestSingleHighHit: SyncSummary
  cryptoBestSingle: SyncSummary
  cryptoBestSingle2x: SyncSummary
  cryptoBestSingle5x: SyncSummary
}

function summarize(data: Awaited<ReturnType<typeof syncForwardTracker>>): SyncSummary {
  return {
    sourceMode: data.meta.sourceMode,
    openTrades: data.summary.openTrades,
    closedTrades: data.summary.closedTrades,
    totalPnlEur: data.summary.totalPnlEur,
    currentSignals: data.meta.currentSignals,
    lastSyncAt: data.meta.lastSyncAt,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    res.setHeader('Cache-Control', 'no-store')

    const [equity, crypto, cryptoHighMove, cryptoHighMoveRelaxed, cryptoBestSingleHighHit, cryptoBestSingle, cryptoBestSingle2x, cryptoBestSingle5x] = await Promise.all([
      syncForwardTracker(req, 'equity'),
      syncForwardTracker(req, 'crypto'),
      syncForwardTracker(req, 'crypto', undefined, 'high_move'),
      syncForwardTracker(req, 'crypto', undefined, 'high_move_relaxed'),
      syncForwardTracker(req, 'crypto', undefined, 'best_single_high_hit'),
      syncForwardTracker(req, 'crypto', undefined, 'best_single'),
      syncForwardTracker(req, 'crypto', undefined, 'best_single_2x'),
      syncForwardTracker(req, 'crypto', undefined, 'best_single_5x'),
    ])

    return res.status(200).json({
      ok: true,
      ranAt: new Date().toISOString(),
      equity: summarize(equity),
      crypto: summarize(crypto),
      cryptoHighMove: summarize(cryptoHighMove),
      cryptoHighMoveRelaxed: summarize(cryptoHighMoveRelaxed),
      cryptoBestSingleHighHit: summarize(cryptoBestSingleHighHit),
      cryptoBestSingle: summarize(cryptoBestSingle),
      cryptoBestSingle2x: summarize(cryptoBestSingle2x),
      cryptoBestSingle5x: summarize(cryptoBestSingle5x),
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
