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

type Recommendation = {
  horizon: Horizon
  cutoff: number
  trades: number
  coverage: number
  winrate: number
  avgReturnPct: number
  medianReturnPct: number
  profitFactor: number | null
  meetsTarget: boolean
}

type MarketResult = {
  market: MarketKey
  recommendation: Recommendation | null
  horizons: HorizonResult[]
  assetStats?: {
    scanned: number
    withSignal: number
    active: number
  }
}

type AssetAdvice = {
  market: MarketKey
  symbol: string
  name: string
  href: string
  status: 'BUY' | 'SELL'
  score: number
  strength: number
  cutoff: number
  horizon: Horizon
  marketMeetsTarget: boolean
  isActiveCertainty: boolean
  advice: 'ACTIEF' | 'WACHT'
  reason: string
  expectedReturnPct: number
  expectedWinrate: number
  expectedCoverage: number
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

const DETAIL_BASE: Record<MarketKey, string> = {
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

function rowIdentity(row: any, market: MarketKey): { symbol: string; name: string } | null {
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

function detailHref(market: MarketKey, symbol: string) {
  const base = DETAIL_BASE[market]
  if (market === 'CRYPTO') return `${base}/${encodeURIComponent(symbol.toLowerCase())}`
  return `${base}/${encodeURIComponent(symbol)}`
}

function certaintyStrength(status: 'BUY' | 'SELL', score: number) {
  return status === 'BUY' ? score : 100 - score
}

function activeReason(status: 'BUY' | 'SELL', score: number, strength: number, cutoff: number, marketMeetsTarget: boolean) {
  if (strength < cutoff) return `Sterkte ${strength} onder cutoff ${cutoff} (${status} score ${score})`
  if (!marketMeetsTarget) return 'Marktfilter haalt target nu niet'
  return `Sterkte ${strength} >= cutoff ${cutoff} en target gehaald`
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
  } as Record<MarketKey, AssetAdvice[]>
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
    const maxAssetsPerMarket = Math.round(clamp(Number(req.query.maxAssetsPerMarket ?? 12), 4, 40))
    const maxAssetsGlobal = Math.round(clamp(Number(req.query.maxAssetsGlobal ?? 120), 20, 600))

    const rowsPerMarket = await Promise.all(
      MARKETS.map(async m => ({
        market: m.key,
        rows: await fetchRows(origin, m.slug),
      }))
    )

    let marketResults: MarketResult[] = rowsPerMarket.map(({ market, rows }) => {
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

    const byMarket = initByMarket()
    const allActionable: AssetAdvice[] = []

    let assetsScanned = 0
    let assetsWithSignal = 0
    let activeAssets = 0

    const byMarketResult = new Map<MarketKey, MarketResult>(marketResults.map(m => [m.market, m]))

    for (const { market, rows } of rowsPerMarket) {
      const rec = byMarketResult.get(market)?.recommendation || null
      const cutoff = rec?.cutoff ?? 70
      const horizon = rec?.horizon ?? 'untilNext'
      const marketMeetsTarget = Boolean(rec?.meetsTarget)
      const expectedReturnPct = Number(rec?.avgReturnPct ?? 0)
      const expectedWinrate = Number(rec?.winrate ?? 0)
      const expectedCoverage = Number(rec?.coverage ?? 0)

      let withSignalCount = 0
      let activeCount = 0

      assetsScanned += rows.length

      for (const row of rows) {
        const id = rowIdentity(row, market)
        if (!id) continue

        const current = row?.current
        const status = current?.status
        const score = Number(current?.score)

        if ((status !== 'BUY' && status !== 'SELL') || !Number.isFinite(score)) continue

        withSignalCount += 1
        assetsWithSignal += 1

        const strength = certaintyStrength(status, Math.round(score))
        const isActiveCertainty = marketMeetsTarget && strength >= cutoff
        if (isActiveCertainty) {
          activeCount += 1
          activeAssets += 1
        }

        const item: AssetAdvice = {
          market,
          symbol: id.symbol,
          name: id.name,
          href: detailHref(market, id.symbol),
          status,
          score: Math.round(score),
          strength,
          cutoff,
          horizon,
          marketMeetsTarget,
          isActiveCertainty,
          advice: isActiveCertainty ? 'ACTIEF' : 'WACHT',
          reason: activeReason(status, Math.round(score), strength, cutoff, marketMeetsTarget),
          expectedReturnPct,
          expectedWinrate,
          expectedCoverage,
        }

        byMarket[market].push(item)
        allActionable.push(item)
      }

      byMarket[market].sort((a, b) => {
        if (a.isActiveCertainty !== b.isActiveCertainty) return a.isActiveCertainty ? -1 : 1
        if (b.strength !== a.strength) return b.strength - a.strength
        return b.expectedReturnPct - a.expectedReturnPct
      })

      byMarket[market] = byMarket[market].slice(0, maxAssetsPerMarket)

      const mr = byMarketResult.get(market)
      if (mr) {
        mr.assetStats = {
          scanned: rows.length,
          withSignal: withSignalCount,
          active: activeCount,
        }
      }
    }

    marketResults = MARKETS.map(m => byMarketResult.get(m.key)!).filter(Boolean)

    const activeList = allActionable
      .filter(a => a.isActiveCertainty)
      .sort((a, b) => {
        if (b.strength !== a.strength) return b.strength - a.strength
        return b.expectedReturnPct - a.expectedReturnPct
      })
      .slice(0, maxAssetsGlobal)

    const waitingList = allActionable
      .filter(a => !a.isActiveCertainty)
      .sort((a, b) => {
        if (b.strength !== a.strength) return b.strength - a.strength
        return b.expectedWinrate - a.expectedWinrate
      })
      .slice(0, maxAssetsGlobal)

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
        note: 'Actieve zekerheid wordt nu op asset-niveau bepaald (aandeel/coin), niet op markt-niveau.',
      },
      summary: {
        markets: marketResults.length,
        marketsWithRecommendation: withRec.length,
        marketsMeetingTarget: meets,
        avgWinrate: avgWin,
        avgReturnPct: avgRet,
        avgCoverage: avgCov,
        assetsScanned,
        assetsWithSignal,
        activeAssets,
        waitingAssets: Math.max(0, assetsWithSignal - activeAssets),
      },
      markets: marketResults,
      assets: {
        active: activeList,
        waiting: waitingList,
        byMarket,
      },
    })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}
