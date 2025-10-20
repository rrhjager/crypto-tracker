// src/pages/api/crypto-light/prices.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON, kvGetJSON } from '@/lib/kv'

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

/* ===== CDN/KV settings ===== */
const EDGE_S_MAXAGE = 20
const EDGE_SWR      = 120
const KV_TTL_SEC    = 30   // snapshot per symbolset
const KV_REVALIDATE = 15

// Sym→ID map cache (top-cap list). We’ll serve stale on error.
const MAP_TTL_SEC        = 24 * 60 * 60 // 24h
const MAP_REVALIDATE_SEC = 6  * 60 * 60 // refresh ~6h

/* ===== Defaults ===== */
const DEFAULT_SYMBOLS = [
  'BTC','ETH','SOL','BNB','XRP','ADA','DOGE','TON','AVAX','DOT','LINK','TRX','MATIC','SHIB','LTC','BCH'
]

/* ===== Static fallback CG symbol→id (top coins) ===== */
const STATIC_CG_MAP: Record<string,string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE:'dogecoin',
  TON: 'the-open-network',
  AVAX:'avalanche-2',
  DOT: 'polkadot',
  LINK:'chainlink',
  TRX: 'tron',
  MATIC:'polygon',
  SHIB:'shiba-inu',
  LTC:'litecoin',
  BCH:'bitcoin-cash',
}

/* ===== Utils ===== */
const sleep = (ms:number)=> new Promise(r=>setTimeout(r,ms))
const okJson = async <T,>(r: Response)=> (await r.json()) as T

function parseSymbols(q: string | string[] | undefined): string[] {
  if (!q) return DEFAULT_SYMBOLS
  const raw = Array.isArray(q) ? q.join(',') : q
  return raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 60)
}

function cgHeaders() {
  const h: Record<string,string> = { 'accept': 'application/json' }
  const key = process.env.COINGECKO_API_KEY || process.env.COINGECKO_PRO_API_KEY
  if (key) h['x-cg-api-key'] = key
  return h
}

/* ===== CoinGecko: dynamic sym→id map (top ~500) ===== */
async function fetchCgTopSymbols(): Promise<Record<string,string>> {
  // Two pages of 250 = ~500 tickers by market cap
  const base = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&sparkline=false'
  const [p1, p2] = await Promise.all([
    fetch(`${base}&page=1`, { cache: 'no-store', headers: cgHeaders() }),
    fetch(`${base}&page=2`, { cache: 'no-store', headers: cgHeaders() }),
  ])
  if (!p1.ok || !p2.ok) throw new Error(`CG markets HTTP ${p1.status}/${p2.status}`)

  const a1: any[] = await okJson(p1)
  const a2: any[] = await okJson(p2)
  const map = new Map<string,string>()
  for (const c of [...a1, ...a2]) {
    const sym = String(c?.symbol || '').toUpperCase()
    const id  = String(c?.id || '')
    if (sym && id && !map.has(sym)) map.set(sym, id) // first = highest mcap
  }
  return Object.fromEntries(map)
}

/* Robust: prefer fresh; else return stale KV; else static fallback */
async function getCgSymMap(): Promise<Record<string,string>> {
  const key = 'cg:symmap:v1'
  type MapSnap = { map: Record<string,string>; updatedAt: number }

  try {
    const snap = await kvRefreshIfStale<MapSnap>(
      key, MAP_TTL_SEC, MAP_REVALIDATE_SEC,
      async () => {
        const map = await fetchCgTopSymbols()
        const payload: MapSnap = { map, updatedAt: Date.now() }
        try { await kvSetJSON(key, payload, MAP_TTL_SEC) } catch {}
        return payload
      }
    )
    if (snap?.map && Object.keys(snap.map).length) return snap.map
  } catch {
    // fall through to stale/static
  }

  // try stale KV without TTL enforcement
  try {
    const stale: MapSnap | null = await kvGetJSON<MapSnap>(key)
    if (stale?.map && Object.keys(stale.map).length) return stale.map
  } catch {}

  // static fallback
  return { ...STATIC_CG_MAP }
}

/* ===== CoinGecko batch prijzen (graceful on 429) ===== */
async function coingeckoBatchByIds(ids: string[], idToSym: Record<string,string>): Promise<Record<string, Quote>> {
  if (!ids.length) return {}
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd&include_24hr_change=true`
  const r = await fetch(url, { cache: 'no-store', headers: cgHeaders() })
  if (!r.ok) {
    // If rate-limited or error, return empty so we fallback to Yahoo
    return {}
  }
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

/* ===== Yahoo fallback (only when CG failed/absent) ===== */
async function yahooQuote(symbol: string): Promise<Quote> {
  const combos: Array<[string, string]> = [['1d','1mo'], ['1d','3mo'], ['1wk','1y']]
  const ysym = `${symbol}-USD`
  const errs: string[] = []
  for (const [interval, range] of combos) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=${interval}&range=${range}`
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
        currency: 'USD',
        marketState: meta?.marketState ?? undefined,
      }
    } catch (e:any) {
      errs.push(`[${ysym} ${interval}/${range}] ${String(e?.message || e)}`)
      await sleep(80)
    }
  }
  // couldn’t fetch
  return {
    symbol,
    regularMarketPrice: null,
    regularMarketChange: null,
    regularMarketChangePercent: null,
    currency: 'USD',
  }
}

/* ===== Builder ===== */
async function buildPrices(symbols: string[]) {
  const errors: string[] = []
  const out: Record<string, Quote> = {}

  // 1) Load sym→id map (robust: fresh or stale KV or static fallback)
  const symToId = await getCgSymMap()
  const idToSym: Record<string,string> = {}
  Object.entries(symToId).forEach(([sym, id]) => { idToSym[id] = sym })

  const cgSyms  = symbols.filter(s => !!symToId[s])
  const rest    = symbols.filter(s => !symToId[s])

  // 2) Try CoinGecko batch; if it returns empty (429), we’ll rely on Yahoo for all
  let cgOut: Record<string, Quote> = {}
  if (cgSyms.length) {
    const ids = cgSyms.map(s => symToId[s])
    cgOut = await coingeckoBatchByIds(ids, idToSym)
    Object.assign(out, cgOut)
    if (!Object.keys(cgOut).length) {
      errors.push('coingecko: batch empty (rate-limited?) → yahoo fallback')
    }
  }

  // 3) Yahoo fallback for missing / all not covered
  const missing = symbols.filter(s => !out[s])
  if (missing.length) {
    let i = 0
    const limit = 3
    await Promise.all(new Array(Math.min(limit, missing.length)).fill(0).map(async () => {
      while (i < missing.length) {
        const s = missing[i++]
        const q = await yahooQuote(s)
        out[s] = q
        if (q.regularMarketPrice == null) {
          errors.push(`${s}: yahoo null`)
        }
      }
    }))
  }

  return { quotes: out, errors }
}

/* ===== Handler ===== */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_S_MAXAGE}, stale-while-revalidate=${EDGE_SWR}`)

  try {
    const symbols = parseSymbols(req.query.symbols as any)
    const kvKey = `crypto:prices:v4:${symbols.join(',')}`

    const snap = await kvRefreshIfStale<{ quotes: Record<string, Quote>, updatedAt: number, errors?: string[] }>(
      kvKey, KV_TTL_SEC, KV_REVALIDATE,
      async () => {
        const payload = await buildPrices(symbols)
        const withTs = { ...payload, updatedAt: Date.now() }
        try { await kvSetJSON(kvKey, withTs, KV_TTL_SEC) } catch {}
        return withTs
      }
    )

    const data = snap || await (async () => {
      const payload = await buildPrices(symbols)
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
        errors: data.errors?.length ? data.errors.slice(0,8) : undefined,
        used: `cg-map(fresh|stale|static)+cg-batch(yahoo-fallback)+kv`,
      }
    })
  } catch (e:any) {
    return res.status(200).json({
      quotes: {},
      meta: {
        requested: 0,
        received: 0,
        partial: false,
        errors: [String(e?.message || e)],
        used: 'error',
      }
    })
  }
}