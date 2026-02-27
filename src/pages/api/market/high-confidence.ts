export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { cache5min } from '@/lib/cacheHeaders'

type MarketKey =
  | 'AEX'
  | 'DAX'
  | 'DOWJONES'
  | 'ETFS'
  | 'FTSE100'
  | 'HANGSENG'
  | 'NASDAQ'
  | 'NIKKEI225'
  | 'SENSEX'
  | 'SP500'
  | 'CRYPTO'

type Horizon = 'd7' | 'd30' | 'untilNext'

type EventPoint = {
  strength: number
  ret: number
}

type Candidate = {
  cutoff: number
  trades: number
  coverage: number
  winrate: number
  avgReturnPct: number
  medianReturnPct: number
  profitFactor: number | null
  meetsTarget: boolean
}

type HorizonResult = {
  horizon: Horizon
  totalEligible: number
  minTrades: number
  best: Candidate | null
}

type MarketResult = {
  market: MarketKey
  recommendation: {
    horizon: Horizon
    cutoff: number
    trades: number
    coverage: number
    winrate: number
    avgReturnPct: number
    medianReturnPct: number
    profitFactor: number | null
    meetsTarget: boolean
  } | null
  horizons: HorizonResult[]
}

const MARKETS: Array<{ key: MarketKey; slug: string }> = [
  { key: 'AEX', slug: 'aex' },
  { key: 'DAX', slug: 'dax' },
  { key: 'DOWJONES', slug: 'dowjones' },
  { key: 'ETFS', slug: 'etfs' },
  { key: 'FTSE100', slug: 'ftse100' },
  { key: 'HANGSENG', slug: 'hangseng' },
  { key: 'NASDAQ', slug: 'nasdaq' },
  { key: 'NIKKEI225', slug: 'nikkei225' },
  { key: 'SENSEX', slug: 'sensex' },
  { key: 'SP500', slug: 'sp500' },
  { key: 'CRYPTO', slug: 'crypto' },
]

const CUT_OFFS = Array.from({ length: 21 }, (_, i) => 50 + i * 2) // 50..90

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function median(arr: number[]) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  if (s.length % 2) return s[m]
  return (s[m - 1] + s[m]) / 2
}

function scoreStrength(status: string, score: number) {
  if (status === 'BUY') return score
  if (status === 'SELL') return 100 - score
  return 0
}

function readReturn(row: any, horizon: Horizon): number | null {
  if (horizon === 'd7') {
    const v = row?.perf?.d7Signal
    return Number.isFinite(v) ? Number(v) : null
  }
  if (horizon === 'd30') {
    const v = row?.perf?.d30Signal
    return Number.isFinite(v) ? Number(v) : null
  }
  const v = row?.nextSignal?.signalReturnPct
  return Number.isFinite(v) ? Number(v) : null
}

function eventsFromRows(rows: any[], horizon: Horizon): EventPoint[] {
  const out: EventPoint[] = []
  for (const row of rows || []) {
    const ls = row?.lastSignal
    if (!ls || (ls.status !== 'BUY' && ls.status !== 'SELL')) continue
    const score = Number(ls.score)
    if (!Number.isFinite(score)) continue
    const ret = readReturn(row, horizon)
    if (!Number.isFinite(ret)) continue
    const strength = scoreStrength(ls.status, score)
    if (!Number.isFinite(strength)) continue
    out.push({ strength, ret: Number(ret) })
  }
  return out
}

function evalCut(events: EventPoint[], cutoff: number, target: number): Candidate | null {
  const subset = events.filter(e => e.strength >= cutoff)
  const n = subset.length
  if (!n) return null

  const vals = subset.map(s => s.ret)
  const wins = vals.filter(v => v > 0).length
  const winrate = wins / n
  const avg = vals.reduce((a, b) => a + b, 0) / n
  const med = median(vals)
  const pos = vals.filter(v => v > 0).reduce((a, b) => a + b, 0)
  const neg = vals.filter(v => v < 0).reduce((a, b) => a + Math.abs(b), 0)
  const pf = neg > 0 ? pos / neg : null

  return {
    cutoff,
    trades: n,
    coverage: n / Math.max(1, events.length),
    winrate,
    avgReturnPct: avg,
    medianReturnPct: med,
    profitFactor: pf,
    meetsTarget: winrate >= target,
  }
}

function pickBest(cands: Candidate[], target: number, minTrades: number): Candidate | null {
  const valid = cands.filter(c => c.trades >= minTrades && c.meetsTarget)
  const fallback = cands.filter(c => c.trades >= minTrades)
  const pool = valid.length ? valid : fallback
  if (!pool.length) return null

  return [...pool].sort((a, b) => {
    if (b.avgReturnPct !== a.avgReturnPct) return b.avgReturnPct - a.avgReturnPct
    if (b.winrate !== a.winrate) return b.winrate - a.winrate
    if (b.coverage !== a.coverage) return b.coverage - a.coverage
    return b.cutoff - a.cutoff
  })[0]
}

async function fetchRows(origin: string, slug: string): Promise<any[]> {
  const r = await fetch(`${origin}/api/past-performance/${slug}`, { cache: 'no-store' })
  if (!r.ok) return []
  const j = await r.json()
  return Array.isArray(j?.rows) ? j.rows : []
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    cache5min(res, 120, 600)

    const proto = (req.headers['x-forwarded-proto'] as string) || 'http'
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000'
    const origin = `${proto}://${host}`

    const targetWinrate = clamp(Number(req.query.targetWinrate ?? 0.8), 0.55, 0.95)
    const minCoverage = clamp(Number(req.query.minCoverage ?? 0.12), 0.03, 0.5)
    const minTradesBase = Math.max(3, Number(req.query.minTrades ?? 8) || 8)

    const rowsPerMarket = await Promise.all(
      MARKETS.map(async m => ({
        market: m.key,
        rows: await fetchRows(origin, m.slug),
      }))
    )

    const marketResults: MarketResult[] = rowsPerMarket.map(({ market, rows }) => {
      const horizons: HorizonResult[] = (['d7', 'd30', 'untilNext'] as Horizon[]).map(h => {
        const events = eventsFromRows(rows, h)
        const minTrades = Math.max(minTradesBase, Math.ceil(events.length * minCoverage))
        const cands = CUT_OFFS.map(c => evalCut(events, c, targetWinrate)).filter(Boolean) as Candidate[]
        const best = pickBest(cands, targetWinrate, minTrades)
        return {
          horizon: h,
          totalEligible: events.length,
          minTrades,
          best,
        }
      })

      const chosen = [...horizons]
        .filter(h => h.best)
        .sort((a, b) => {
          const aa = a.best!
          const bb = b.best!
          if (aa.meetsTarget !== bb.meetsTarget) return aa.meetsTarget ? -1 : 1
          if (bb.avgReturnPct !== aa.avgReturnPct) return bb.avgReturnPct - aa.avgReturnPct
          if (bb.winrate !== aa.winrate) return bb.winrate - aa.winrate
          return bb.coverage - aa.coverage
        })[0]

      return {
        market,
        recommendation: chosen?.best
          ? {
              horizon: chosen.horizon,
              cutoff: chosen.best.cutoff,
              trades: chosen.best.trades,
              coverage: chosen.best.coverage,
              winrate: chosen.best.winrate,
              avgReturnPct: chosen.best.avgReturnPct,
              medianReturnPct: chosen.best.medianReturnPct,
              profitFactor: chosen.best.profitFactor,
              meetsTarget: chosen.best.meetsTarget,
            }
          : null,
        horizons,
      }
    })

    const withRec = marketResults.filter(m => m.recommendation)
    const meets = withRec.filter(m => m.recommendation?.meetsTarget).length
    const avgWin = withRec.length
      ? withRec.reduce((s, m) => s + (m.recommendation?.winrate || 0), 0) / withRec.length
      : 0
    const avgRet = withRec.length
      ? withRec.reduce((s, m) => s + (m.recommendation?.avgReturnPct || 0), 0) / withRec.length
      : 0
    const avgCov = withRec.length
      ? withRec.reduce((s, m) => s + (m.recommendation?.coverage || 0), 0) / withRec.length
      : 0

    return res.status(200).json({
      meta: {
        generatedAt: new Date().toISOString(),
        targetWinrate,
        minCoverage,
        minTradesBase,
        note: 'To reach higher precision, trade only signals with strength >= cutoff and use market-specific horizon.',
      },
      summary: {
        markets: marketResults.length,
        marketsWithRecommendation: withRec.length,
        marketsMeetingTarget: meets,
        avgWinrate: avgWin,
        avgReturnPct: avgRet,
        avgCoverage: avgCov,
      },
      markets: marketResults,
    })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}
