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

    const [equity, crypto] = await Promise.all([
      syncForwardTracker(req, 'equity'),
      syncForwardTracker(req, 'crypto'),
    ])

    return res.status(200).json({
      ok: true,
      ranAt: new Date().toISOString(),
      equity: summarize(equity),
      crypto: summarize(crypto),
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
