export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { cache5min } from '@/lib/cacheHeaders'
import type { HCMarketKey, HCHorizon } from '@/lib/highConfidence'
import type { PremiumActiveResponse, PremiumSignal } from '@/lib/premiumActive'

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

type Recommendation = Candidate & {
  horizon: HCHorizon
}

type EventPoint = {
  symbol: string
  name: string
  date: string
  side: 'BUY' | 'SELL'
  score: number
  strength: number
  returns: Record<HCHorizon, number | null>
}

const MARKETS: Array<{ key: HCMarketKey; slug: string }> = [
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

const CUT_OFFS = Array.from({ length: 21 }, (_, i) => 50 + i * 2)

const DETAIL_BASE: Record<HCMarketKey, string> = {
  AEX: '/stocks',
  DAX: '/dax',
  DOWJONES: '/dowjones',
  ETFS: '/etfs',
  FTSE100: '/ftse100',
  HANGSENG: '/hangseng',
  NASDAQ: '/nasdaq',
  NIKKEI225: '/nikkei225',
  SENSEX: '/sensex',
  SP500: '/sp500',
  CRYPTO: '/crypto',
}

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

function readReturn(row: any, horizon: HCHorizon): number | null {
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

function rowIdentity(row: any, market: HCMarketKey): { symbol: string; name: string } | null {
  if (market === 'CRYPTO') {
    const symbol = String(row?.coin || row?.symbol || row?.pair || '').trim()
    if (!symbol) return null
    const name = String(row?.name || symbol).trim() || symbol
    return { symbol, name }
  }

  const symbol = String(row?.symbol || '').trim()
  if (!symbol) return null
  const name = String(row?.name || symbol).trim() || symbol
  return { symbol, name }
}

function detailHref(market: HCMarketKey, symbol: string) {
  const base = DETAIL_BASE[market]
  if (market === 'CRYPTO') return `${base}/${encodeURIComponent(symbol.toLowerCase())}`
  return `${base}/${encodeURIComponent(symbol)}`
}

function initByMarket() {
  return {
    AEX: [],
    DAX: [],
    DOWJONES: [],
    ETFS: [],
    FTSE100: [],
    HANGSENG: [],
    NASDAQ: [],
    NIKKEI225: [],
    SENSEX: [],
    SP500: [],
    CRYPTO: [],
  } as Record<HCMarketKey, PremiumSignal[]>
}

function buildEvents(rows: any[], market: HCMarketKey): EventPoint[] {
  const events: EventPoint[] = []
  for (const row of rows || []) {
    const id = rowIdentity(row, market)
    if (!id) continue
    const ls = row?.lastSignal
    if (!ls || (ls.status !== 'BUY' && ls.status !== 'SELL')) continue
    const score = Math.round(Number(ls.score))
    if (!Number.isFinite(score)) continue
    events.push({
      symbol: id.symbol,
      name: id.name,
      date: String(ls.date || ''),
      side: ls.status,
      score,
      strength: scoreStrength(ls.status, score),
      returns: {
        d7: readReturn(row, 'd7'),
        d30: readReturn(row, 'd30'),
        untilNext: readReturn(row, 'untilNext'),
      },
    })
  }

  return events.sort((a, b) => a.date.localeCompare(b.date))
}

function evalCut(events: EventPoint[], horizon: HCHorizon, cutoff: number, target: number): Candidate | null {
  const subset = events.filter((e) => e.strength >= cutoff && Number.isFinite(e.returns[horizon]))
  const n = subset.length
  if (!n) return null

  const vals = subset.map((s) => Number(s.returns[horizon]))
  const wins = vals.filter((v) => v > 0).length
  const winrate = wins / n
  const avg = vals.reduce((a, b) => a + b, 0) / n
  const med = median(vals)
  const pos = vals.filter((v) => v > 0).reduce((a, b) => a + b, 0)
  const neg = vals.filter((v) => v < 0).reduce((a, b) => a + Math.abs(b), 0)
  const eligible = events.filter((e) => Number.isFinite(e.returns[horizon])).length

  return {
    cutoff,
    trades: n,
    coverage: n / Math.max(1, eligible),
    winrate,
    avgReturnPct: avg,
    medianReturnPct: med,
    profitFactor: neg > 0 ? pos / neg : null,
    meetsTarget: winrate >= target,
  }
}

function pickBest(cands: Candidate[], target: number, minTrades: number): Candidate | null {
  const valid = cands.filter((c) => c.trades >= minTrades && c.meetsTarget)
  const fallback = cands.filter((c) => c.trades >= minTrades)
  const pool = valid.length ? valid : fallback
  if (!pool.length) return null

  return [...pool].sort((a, b) => {
    if (b.avgReturnPct !== a.avgReturnPct) return b.avgReturnPct - a.avgReturnPct
    if (b.winrate !== a.winrate) return b.winrate - a.winrate
    if (b.coverage !== a.coverage) return b.coverage - a.coverage
    return b.cutoff - a.cutoff
  })[0]
}

function pickRecommendation(
  events: EventPoint[],
  targetWinrate: number,
  minCoverage: number,
  minTradesBase: number
): Recommendation | null {
  const horizons = (['d7', 'd30', 'untilNext'] as HCHorizon[])
    .map((horizon) => {
      const eligible = events.filter((e) => Number.isFinite(e.returns[horizon])).length
      const minTrades = Math.max(minTradesBase, Math.ceil(eligible * minCoverage))
      const cands = CUT_OFFS
        .map((cutoff) => evalCut(events, horizon, cutoff, targetWinrate))
        .filter(Boolean) as Candidate[]
      const best = pickBest(cands, targetWinrate, minTrades)
      return best ? { horizon, best } : null
    })
    .filter(Boolean) as Array<{ horizon: HCHorizon; best: Candidate }>

  if (!horizons.length) return null

  const chosen = [...horizons].sort((a, b) => {
    if (a.best.meetsTarget !== b.best.meetsTarget) return a.best.meetsTarget ? -1 : 1
    if (b.best.avgReturnPct !== a.best.avgReturnPct) return b.best.avgReturnPct - a.best.avgReturnPct
    if (b.best.winrate !== a.best.winrate) return b.best.winrate - a.best.winrate
    return b.best.coverage - a.best.coverage
  })[0]

  return {
    horizon: chosen.horizon,
    ...chosen.best,
  }
}

function summarizeValidation(
  records: Array<{ ret: number; side: 'BUY' | 'SELL' }>,
  targetWinrate: number
) {
  const n = records.length
  if (!n) {
    return {
      trades: 0,
      winrate: 0,
      avgReturnPct: 0,
      medianReturnPct: 0,
      profitFactor: null,
      buyCount: 0,
      sellCount: 0,
      meetsTarget: false,
    }
  }

  const vals = records.map((r) => r.ret)
  const wins = vals.filter((v) => v > 0).length
  const avg = vals.reduce((a, b) => a + b, 0) / n
  const med = median(vals)
  const pos = vals.filter((v) => v > 0).reduce((a, b) => a + b, 0)
  const neg = vals.filter((v) => v < 0).reduce((a, b) => a + Math.abs(b), 0)
  const winrate = wins / n

  return {
    trades: n,
    winrate,
    avgReturnPct: avg,
    medianReturnPct: med,
    profitFactor: neg > 0 ? pos / neg : null,
    buyCount: records.filter((r) => r.side === 'BUY').length,
    sellCount: records.filter((r) => r.side === 'SELL').length,
    meetsTarget: winrate >= targetWinrate,
  }
}

async function fetchRows(origin: string, slug: string): Promise<any[]> {
  const r = await fetch(`${origin}/api/past-performance/${slug}`, { cache: 'no-store' })
  if (!r.ok) return []
  const j = await r.json()
  return Array.isArray(j?.rows) ? j.rows : []
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<PremiumActiveResponse | { error: string }>) {
  try {
    cache5min(res, 120, 600)

    const proto = (req.headers['x-forwarded-proto'] as string) || 'http'
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000'
    const origin = `${proto}://${host}`

    const targetWinrate = clamp(Number(req.query.targetWinrate ?? 0.8), 0.6, 0.95)
    const minCoverage = clamp(Number(req.query.minCoverage ?? 0.12), 0.05, 0.5)
    const minTradesBase = Math.max(4, Number(req.query.minTrades ?? 8) || 8)
    const minValidationTrades = Math.max(4, Number(req.query.minValidationTrades ?? 6) || 6)
    const maxSignalsPerMarket = Math.round(clamp(Number(req.query.maxSignalsPerMarket ?? 40), 4, 80))
    const maxSignalsGlobal = Math.round(clamp(Number(req.query.maxSignalsGlobal ?? 160), 20, 300))

    const rowsPerMarket = await Promise.all(
      MARKETS.map(async (m) => ({
        market: m.key,
        rows: await fetchRows(origin, m.slug),
      }))
    )

    const byMarket = initByMarket()
    const allSignals: PremiumSignal[] = []

    const markets = rowsPerMarket.map(({ market, rows }) => {
      const events = buildEvents(rows, market)
      const recommendation = pickRecommendation(events, targetWinrate, minCoverage, minTradesBase)

      const validationRecords: Array<{ ret: number; side: 'BUY' | 'SELL' }> = []
      for (let i = 0; i < events.length; i++) {
        const ev = events[i]
        const train = events.filter((_, idx) => idx !== i)
        const looRec = pickRecommendation(train, targetWinrate, minCoverage, minTradesBase)
        if (!looRec || !looRec.meetsTarget) continue
        const ret = ev.returns[looRec.horizon]
        if (!Number.isFinite(ret)) continue
        if (ev.strength < looRec.cutoff) continue
        validationRecords.push({ ret: Number(ret), side: ev.side })
      }

      const validation = summarizeValidation(validationRecords, targetWinrate)
      const passed = Boolean(
        recommendation &&
        recommendation.meetsTarget &&
        validation.trades >= minValidationTrades &&
        validation.meetsTarget &&
        validation.avgReturnPct > 0
      )

      let currentSignals = 0

      if (passed && recommendation) {
        for (const row of rows) {
          const id = rowIdentity(row, market)
          if (!id) continue

          const current = row?.current
          const status = current?.status
          const score = Math.round(Number(current?.score))

          if ((status !== 'BUY' && status !== 'SELL') || !Number.isFinite(score)) continue

          const strength = scoreStrength(status, score)
          if (strength < recommendation.cutoff) continue

          currentSignals += 1

          const item: PremiumSignal = {
            market,
            symbol: id.symbol,
            name: id.name,
            href: detailHref(market, id.symbol),
            status,
            score,
            strength,
            cutoff: recommendation.cutoff,
            horizon: recommendation.horizon,
            marketMeetsTarget: true,
            isActiveCertainty: true,
            advice: 'ACTIEF',
            reason: `LOO validatie ${Math.round(validation.winrate * 100)}% over ${validation.trades} trades. Volg tot dit signaal wegvalt of draait.`,
            expectedReturnPct: validation.avgReturnPct,
            expectedWinrate: validation.winrate,
            expectedCoverage: recommendation.coverage,
            action: status === 'BUY' ? 'BUY NOW' : 'SELL / EXIT',
            validationWinrate: validation.winrate,
            validationReturnPct: validation.avgReturnPct,
            validationTrades: validation.trades,
          }

          byMarket[market].push(item)
          allSignals.push(item)
        }

        byMarket[market].sort((a, b) => {
          if (a.status !== b.status) return a.status === 'BUY' ? -1 : 1
          if (b.strength !== a.strength) return b.strength - a.strength
          return b.validationReturnPct - a.validationReturnPct
        })
        byMarket[market] = byMarket[market].slice(0, maxSignalsPerMarket)
      }

      return {
        market,
        recommendation,
        validation,
        passed,
        currentSignals,
      }
    })

    const liveSignals = allSignals
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'BUY' ? -1 : 1
        if (b.strength !== a.strength) return b.strength - a.strength
        return b.validationReturnPct - a.validationReturnPct
      })
      .slice(0, maxSignalsGlobal)

    return res.status(200).json({
      meta: {
        generatedAt: new Date().toISOString(),
        targetWinrate,
        minValidationTrades,
        note:
          'Premium Active gebruikt strengere validatie: alleen markten die hun ACTIEF-filter ook in leave-one-out validatie halen, blijven over.',
      },
      summary: {
        validatedMarkets: markets.filter((m) => m.passed).length,
        liveSignals: liveSignals.length,
        buySignals: liveSignals.filter((s) => s.status === 'BUY').length,
        sellSignals: liveSignals.filter((s) => s.status === 'SELL').length,
      },
      markets,
      signals: {
        all: liveSignals,
        buy: liveSignals.filter((s) => s.status === 'BUY'),
        sell: liveSignals.filter((s) => s.status === 'SELL'),
        byMarket,
      },
    })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}
