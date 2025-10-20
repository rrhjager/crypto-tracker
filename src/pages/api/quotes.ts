// src/pages/api/quotes.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'

export const config = { runtime: 'nodejs' }

type Quote = {
  symbol: string
  longName?: string
  shortName?: string
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  currency?: string
  marketState?: string
}
type Resp = {
  quotes: Record<string, Quote>
  meta?: {
    requested: number
    received: number
    partial: boolean
    errors?: string[]
    used: string
  }
}

/* ===== Cache/edge settings ===== */
const EDGE_S_MAXAGE = 20;   // 20s CDN cache
const EDGE_SWR      = 120;  // 2m stale-while-revalidate
const KV_TTL_SEC    = 20;   // 20s KV snapshot (quotes)
const KV_REVALIDATE = 10;   // refresh ~10s before TTL

// Symbol-map (CoinGecko top coins) — longer TTL
const MAP_TTL_SEC        = 6 * 60 * 60; // 6 hours
const MAP_REVALIDATE_SEC = 2 * 60 * 60; // refresh after ~4h

/* ===== Utils ===== */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const okJson = async <T,>(r: Response) => (await r.json()) as T

function parseSymbols(q: string | string[] | undefined): string[] {
  const raw = Array.isArray(q) ? q.join(',') : (q || '')
  const syms = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  return syms.slice(0, 60)
}

/* ===== CoinGecko: dynamic sym→id map (top ~500) ===== */
async function fetchCgTopSymbols(): Promise<Record<string, string>> {
  // Two pages of 250 = ~500 tickers by market cap
  const base = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&sparkline=false'
  const [p1, p2] = await Promise.all([
    fetch(`${base}&page=1`, { cache: 'no-store' }),
    fetch(`${base}&page=2`, { cache: 'no-store' }),
  ])
  if (!p1.ok || !p2.ok) throw new Error(`CG markets HTTP ${p1.status}/${p2.status}`)

  const a1: any[] = await okJson(p1)
  const a2: any[] = await okJson(p2)
  const all = [...a1, ...a2]

  // symbol may collide; keep first (highest mcap)
  const map = new Map<string, string>()
  for (const c of all) {
    const sym = String(c?.symbol || '').toUpperCase()
    const id  = String(c?.id || '')
    if (!sym || !id) continue
    if (!map.has(sym)) map.set(sym, id)
  }
  return Object.fromEntries(map)
}

async function getCgSymMap(): Promise<Record<string, string>> {
  const key = 'cg:symmap:v1'
  type MapSnap = { map: Record<string, string>; updatedAt: number }

  const snap = await kvRefreshIfStale<MapSnap>(
    key,
    MAP_TTL_SEC,
    MAP_REVALIDATE_SEC,
    async () => {
      const map = await fetchCgTopSymbols()
      const payload: MapSnap = { map, updatedAt: Date.now() }
      try { await kvSetJSON(key, payload, MAP_TTL_SEC) } catch {}
      return payload
    }
  )

  if (!snap) {
    const map = await fetchCgTopSymbols()
    const payload: MapSnap = { map, updatedAt: Date.now() }
    try { await kvSetJSON(key, payload, MAP_TTL_SEC) } catch {}
    return payload.map
  }

  return snap.map
}

/* ===== CoinGecko batch prices ===== */
async function coingeckoBatchByIds(
  ids: string[],
  idToSym: Record<string, string>
): Promise<Record<string, Quote>> {
  if (!ids.length) return {}
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd&include_24hr_change=true`
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`)
  const j: any = await r.json()

  const out: Record<string, Quote> = {}
  for (const [id, payload] of Object.entries(j)) {
    const sym = (idToSym[id] || '').toUpperCase()
    if (!sym) continue
    const p: any = payload
    const px = Number(p?.usd)
    const chgPct = Number(p?.usd_24h_change)
    const priceOk = Number.isFinite(px)
    const pctOk = Number.isFinite(chgPct)
    const change = (priceOk && pctOk) ? px * (chgPct / 100) : null

    out[sym] = {
      symbol: sym,
      regularMarketPrice: priceOk ? px : null,
      regularMarketChange: change,
      regularMarketChangePercent: pctOk ? chgPct : null,
      currency: 'USD',
      marketState: 'REGULAR',
    }
  }
  return out
}

/* ===== Yahoo Chart (stocks + fallback crypto) ===== */
async function yahooQuoteChart(symbol: string): Promise<Quote> {
  const combos: Array<[string, string]> = [
    ['1d', '1mo'],
    ['1d', '3mo'],
    ['1wk', '1y'],
  ]
  const isCryptoLike = /^[A-Z0-9]{2,10}$/.test(symbol)
  const yahooSym = isCryptoLike ? `${symbol}-USD` : symbol
  const errs: string[] = []

  for (const [interval, range] of combos) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${interval}&range=${range}`
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j: any = await okJson(r)
      const res = j?.chart?.result?.[0]
      const meta = res?.meta || {}
      const series = res?.indicators?.quote?.[0] || {}
      const closes: number[] = (series.close || []).map(Number)

      let last: number | null = null
      let prev: number | null = null
      for (let i = closes.length - 1; i >= 0; i--) {
        const v = closes[i]
        if (Number.isFinite(v)) {
          if (last == null) last = v
          else { prev = v; break }
        }
      }
      if (last == null) throw new Error('no closes')

      const change = prev != null ? last - prev : null
      const changePct = prev != null && prev !== 0 ? (change as number) / prev * 100 : null

      return {
        symbol,
        longName: meta?.symbol ?? undefined,
        shortName: meta?.symbol ?? undefined,
        regularMarketPrice: last,
        regularMarketChange: change,
        regularMarketChangePercent: changePct,
        currency: meta?.currency || (isCryptoLike ? 'USD' : undefined),
        marketState: meta?.marketState ?? undefined,
      }
    } catch (e: any) {
      errs.push(`[${yahooSym} ${interval}/${range}] ${String(e?.message || e)}`)
      await sleep(120)
    }
  }
  throw new Error(errs.join(' | '))
}

/* ===== Builder ===== */
async function buildQuotes(symbols: string[]) {
  const errors: string[] = []
  const out: Record<string, Quote> = {}

  // 1) load CoinGecko sym→id (top ~500) and build id→sym
  const symToId = await getCgSymMap()
  const idToSym: Record<string, string> = {}
  Object.entries(symToId).forEach(([sym, id]) => { idToSym[id] = sym })

  // Split into crypto (we have an id) and others (stocks or non-top crypto)
  const cryptoSyms = symbols.filter(s => !!symToId[s])
  const otherSyms  = symbols.filter(s => !symToId[s])

  // 2) crypto batch (cheap)
  if (cryptoSyms.length) {
    const ids = cryptoSyms.map(s => symToId[s])
    try {
      const cg = await coingeckoBatchByIds(ids, idToSym)
      Object.assign(out, cg)
    } catch (e: any) {
      errors.push(`coingecko: ${String(e?.message || e)}`)
    }
  }

  // 3) remaining via Yahoo (limited concurrency)
  const missing = [...otherSyms]
  let i = 0
  const limit = 4
  const workers = new Array(Math.min(limit, missing.length)).fill(0).map(async () => {
    while (i < missing.length) {
      const idx = i++
      const s = missing[idx]
      try {
        out[s] = await yahooQuoteChart(s)
      } catch (e: any) {
        errors.push(`${s}: ${String(e?.message || e)}`)
        out[s] = {
          symbol: s,
          regularMarketPrice: null,
          regularMarketChange: null,
          regularMarketChangePercent: null,
        }
      }
    }
  })
  await Promise.all(workers)

  return { quotes: out, errors }
}

/* ===== Handler ===== */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_S_MAXAGE}, stale-while-revalidate=${EDGE_SWR}`)

  try {
    const symbols = parseSymbols(req.query.symbols as any)
    if (!symbols.length) return res.status(400).json({ error: 'symbols required' })

    const kvKey = `quotes:v4:${symbols.join(',')}`

    const snap = await kvRefreshIfStale<{ quotes: Record<string, Quote>, updatedAt: number, errors?: string[] }>(
      kvKey,
      KV_TTL_SEC,
      KV_REVALIDATE,
      async () => {
        const payload = await buildQuotes(symbols)
        const withTs = { ...payload, updatedAt: Date.now() }
        try { await kvSetJSON(kvKey, withTs, KV_TTL_SEC) } catch {}
        return withTs
      }
    )

    const data = snap || await (async () => {
      const payload = await buildQuotes(symbols)
      const withTs = { ...payload, updatedAt: Date.now() }
      try { await kvSetJSON(kvKey, withTs, KV_TTL_SEC) } catch {}
      return withTs
    })()

    return res.status(200).json({
      quotes: data.quotes,
      meta: {
        requested: symbols.length,
        received: Object.values(data.quotes).filter(q => q.regularMarketPrice != null).length,
        partial: Object.values(data.quotes).some(q => q.regularMarketPrice == null),
        errors: data.errors?.length ? data.errors.slice(0, 8) : undefined,
        used: 'cg-map(top500)+cg-batch+yahoo-fallback+kv',
      }
    })
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || e) })
  }
}