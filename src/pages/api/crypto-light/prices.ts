// src/pages/api/crypto-light/prices.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON, kvGetJSON } from '@/lib/kv'

export const config = { runtime: 'nodejs' }

/* ===== Types ===== */
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
type MetaDebug = {
  now: string
  symbols: string[]
  timings: Record<string, number>
  path: {
    map: 'fresh' | 'stale' | 'static' | 'error'
    prices: 'coingecko' | 'yahoo' | 'mixed' | 'none'
  }
  mapStats: { size: number, keysExample: string[] }
  cg?: { status?: number, rateLimited?: boolean, err?: string }
  yahoo?: { attempts: number, errors: string[] }
  kvKey: string
  env: { hasCgKey: boolean, nodeEnv: string }
  headers?: Record<string,string>
}
type Resp = {
  quotes: Record<string, Quote>
  // ⬇️ extra shape die de UI verwacht
  results?: Array<{ symbol: string; price: number|null; d: number|null; w: number|null; m: number|null }>
  meta?: {
    requested: number
    received: number
    partial: boolean
    errors?: string[]
    used: string
    debug?: MetaDebug
  }
}

/* ===== CDN/KV settings ===== */
const EDGE_S_MAXAGE = 20
const EDGE_SWR      = 120
const KV_TTL_SEC    = 30
const KV_REVALIDATE = 15

const MAP_TTL_SEC        = 24 * 60 * 60
const MAP_REVALIDATE_SEC = 6  * 60 * 60

/* ===== Defaults ===== */
const DEFAULT_SYMBOLS = [
  'BTC','ETH','SOL','BNB','XRP','ADA','DOGE','TON','AVAX','DOT','LINK','TRX','MATIC','SHIB','LTC','BCH'
]

/* ===== Static fallback CG symbol→id ===== */
const STATIC_CG_MAP: Record<string,string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple',  ADA: 'cardano',  DOGE:'dogecoin', TON: 'the-open-network',
  AVAX:'avalanche-2', DOT: 'polkadot', LINK:'chainlink', TRX: 'tron',
  MATIC:'polygon', SHIB:'shiba-inu', LTC:'litecoin', BCH:'bitcoin-cash',
}

/* ===== Utils ===== */
const okJson = async <T,>(r: Response)=> (await r.json()) as T
const time = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const shouldLog = (req: NextApiRequest) => req.query.debug === '1' || process.env.NODE_ENV !== 'production'
const log = (req: NextApiRequest, ...args: any[]) => { if (shouldLog(req)) console.log('[crypto-prices]', ...args) }
const err = (req: NextApiRequest, ...args: any[]) => { if (shouldLog(req)) console.error('[crypto-prices]', ...args) }

// normaliseer: accepteer BTC / btc / BTCUSDT → BTC
const STABLES = new Set(['USDT','USDC','BUSD','DAI','TUSD'])
function toBaseSymbol(s: string): string | null {
  const raw = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!raw) return null
  if (STABLES.has(raw)) return null
  const base = raw.endsWith('USDT') ? raw.slice(0, -4) : raw
  if (!base || STABLES.has(base)) return null
  return base
}
function parseSymbols(q: string | string[] | undefined): string[] {
  const raw = Array.isArray(q) ? q.join(',') : q || DEFAULT_SYMBOLS.join(',')
  const out: string[] = []
  for (const p of raw.split(',')) {
    const b = toBaseSymbol(p.trim())
    if (b) out.push(b)
    if (out.length >= 60) break
  }
  return Array.from(new Set(out))
}
function cgHeaders() {
  const h: Record<string,string> = { 'accept': 'application/json' }
  const key = process.env.COINGECKO_API_KEY || process.env.COINGECKO_PRO_API_KEY
  if (key) h['x-cg-api-key'] = key
  return h
}

/* ===== CoinGecko sym→id map ===== */
async function fetchCgTopSymbols(req: NextApiRequest, dbg: MetaDebug): Promise<Record<string,string>> {
  const t0 = time()
  const base = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&sparkline=false'
  const [p1, p2] = await Promise.all([
    fetch(`${base}&page=1`, { cache: 'no-store', headers: cgHeaders() }),
    fetch(`${base}&page=2`, { cache: 'no-store', headers: cgHeaders() }),
  ])
  dbg.timings['cg_map_fetch'] = Math.round(time() - t0)
  if (!p1.ok || !p2.ok) {
    dbg.cg = { status: (!p1.ok ? p1.status : p2.status), rateLimited: p1.status===429 || p2.status===429 }
    throw new Error(`CG markets HTTP ${p1.status}/${p2.status}`)
  }
  const a1: any[] = await okJson(p1)
  const a2: any[] = await okJson(p2)
  const map = new Map<string,string>()
  for (const c of [...a1, ...a2]) {
    const sym = String(c?.symbol || '').toUpperCase()
    const id  = String(c?.id || '')
    if (sym && id && !map.has(sym)) map.set(sym, id)
  }
  return Object.fromEntries(map)
}
async function getCgSymMap(req: NextApiRequest, dbg: MetaDebug): Promise<{map:Record<string,string>, source: 'fresh'|'stale'|'static'|'error'}> {
  const key = 'cg:symmap:v1'
  type MapSnap = { map: Record<string,string>; updatedAt: number }

  try {
    const snap = await kvRefreshIfStale<MapSnap>(
      key, MAP_TTL_SEC, MAP_REVALIDATE_SEC,
      async () => {
        const t0 = time()
        const map = await fetchCgTopSymbols(req, dbg)
        dbg.timings['kv_set_map'] = Math.round(time() - t0)
        const payload: MapSnap = { map, updatedAt: Date.now() }
        try { await kvSetJSON(key, payload, MAP_TTL_SEC) } catch (e:any) { err(req, 'KV set map fail', e?.message || e) }
        return payload
      }
    )
    if (snap?.map && Object.keys(snap.map).length) {
      dbg.path.map = 'fresh'
      return { map: snap.map, source: 'fresh' }
    }
  } catch (e:any) {
    err(req, 'fresh map error', e?.message || e)
  }

  try {
    const stale: any = await kvGetJSON(key)
    if (stale?.map && Object.keys(stale.map).length) {
      dbg.path.map = 'stale'
      return { map: stale.map, source: 'stale' }
    }
  } catch (e:any) {
    err(req, 'stale map error', e?.message || e)
  }

  dbg.path.map = 'static'
  return { map: { ...STATIC_CG_MAP }, source: 'static' }
}

/* ===== Price providers ===== */
async function coingeckoBatchByIds(ids: string[], idToSym: Record<string,string>, req: NextApiRequest, dbg: MetaDebug): Promise<Record<string, Quote>> {
  if (!ids.length) return {}
  const t0 = time()
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd&include_24hr_change=true`
  const r = await fetch(url, { cache: 'no-store', headers: cgHeaders() })
  dbg.timings['cg_price_fetch'] = Math.round(time() - t0)
  if (!r.ok) {
    dbg.cg = { ...(dbg.cg||{}), status: r.status, rateLimited: r.status === 429 }
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

async function yahooQuote(symbol: string): Promise<Quote> {
  const combos: Array<[string, string]> = [['1d','1mo'], ['1d','3mo'], ['1wk','1y']]
  const ysym = `${symbol}-USD`
  for (const [interval, range] of combos) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=${interval}&range=${range}`
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) continue
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
    if (last == null) continue

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
  }
  return {
    symbol,
    regularMarketPrice: null,
    regularMarketChange: null,
    regularMarketChangePercent: null,
    currency: 'USD',
  }
}

/* ===== Builder ===== */
async function buildPrices(symbols: string[], req: NextApiRequest, dbg: MetaDebug) {
  const errors: string[] = []
  const out: Record<string, Quote> = {}

  // 1) sym→id map
  const mapRes = await getCgSymMap(req, dbg)
  const symToId = mapRes.map
  const idToSym: Record<string,string> = {}
  Object.entries(symToId).forEach(([sym, id]) => { idToSym[id] = sym })
  dbg.mapStats = { size: Object.keys(symToId).length, keysExample: Object.keys(symToId).slice(0,6) }

  const cgSyms  = symbols.filter(s => !!symToId[s])

  // 2) CoinGecko batch
  let cgOut: Record<string, Quote> = {}
  if (cgSyms.length) {
    const ids = cgSyms.map(s => symToId[s])
    cgOut = await coingeckoBatchByIds(ids, idToSym, req, dbg)
    Object.assign(out, cgOut)
    if (!Object.keys(cgOut).length) {
      errors.push('coingecko: batch empty (rate-limited or error) → yahoo fallback')
    }
  }

  // 3) Yahoo fallback
  const missing = symbols.filter(s => !out[s])
  const yahooErrors: string[] = []
  if (missing.length) {
    let i = 0
    const limit = 3
    await Promise.all(new Array(Math.min(limit, missing.length)).fill(0).map(async () => {
      while (i < missing.length) {
        const s = missing[i++]
        try {
          const q = await yahooQuote(s)
          out[s] = q
          if (q.regularMarketPrice == null) yahooErrors.push(`${s}: yahoo null`)
        } catch (e:any) {
          yahooErrors.push(`${s}: ${String(e?.message || e)}`)
        }
      }
    }))
  }

  if (yahooErrors.length) errors.push(...yahooErrors)
  const pathPrices =
    Object.keys(out).length === 0 ? 'none'
    : (Object.keys(cgOut).length && missing.length ? 'mixed'
      : Object.keys(cgOut).length ? 'coingecko' : 'yahoo')

  dbg.path.prices = pathPrices as any
  return { quotes: out, errors }
}

/* ===== Handler ===== */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_S_MAXAGE}, stale-while-revalidate=${EDGE_SWR}`)
  const debug = req.query.debug === '1'

  // we bewaren ook de originele query-symbols (kunnen Binance-pairs zijn)
  const raw = Array.isArray(req.query.symbols) ? req.query.symbols.join(',') : (req.query.symbols as string|undefined) || ''
  const originalSymbols = raw.split(',').map(s => s.trim()).filter(Boolean)

  const symbols = parseSymbols(req.query.symbols as any)
  const kvKey = `crypto:prices:v4:${symbols.join(',')}`

  const dbg: MetaDebug | undefined = debug ? {
    now: new Date().toISOString(),
    symbols,
    timings: {},
    path: { map: 'error', prices: 'none' },
    mapStats: { size: 0, keysExample: [] },
    yahoo: { attempts: 0, errors: [] },
    kvKey,
    env: { hasCgKey: !!(process.env.COINGECKO_API_KEY || process.env.COINGECKO_PRO_API_KEY), nodeEnv: process.env.NODE_ENV || '' },
    headers: {
      host: String(req.headers.host || ''),
      origin: String(req.headers.origin || ''),
      referer: String(req.headers.referer || ''),
      'user-agent': String(req.headers['user-agent'] || '')
    }
  } : undefined

  const t0 = time()
  try {
    const snap = await kvRefreshIfStale<{ quotes: Record<string, Quote>, updatedAt: number, errors?: string[] }>(
      kvKey, KV_TTL_SEC, KV_REVALIDATE,
      async () => {
        const tBuild0 = time()
        const payload = await buildPrices(symbols, req, dbg!)
        const withTs = { ...payload, updatedAt: Date.now() }
        try { await kvSetJSON(kvKey, withTs, KV_TTL_SEC) } catch (e:any) { err(req, 'KV set snapshot fail', e?.message || e) }
        if (dbg) dbg.timings['build_prices_ms'] = Math.round(time() - tBuild0)
        return withTs
      }
    )

    const data = snap || await (async () => {
      const tBuild0 = time()
      const payload = await buildPrices(symbols, req, dbg!)
      const withTs = { ...payload, updatedAt: Date.now() }
      try { await kvSetJSON(kvKey, withTs, KV_TTL_SEC) } catch (e:any) { err(req, 'KV set snapshot fail (no-snap)', e?.message || e) }
      if (dbg) dbg.timings['build_prices_ms'] = Math.round(time() - tBuild0)
      return withTs
    })()

    const received = Object.values(data.quotes).filter(q => q.regularMarketPrice != null).length
    const partial  = Object.values(data.quotes).some(q => q.regularMarketPrice == null)

    if (dbg) {
      dbg.timings['total_ms'] = Math.round(time() - t0)
      dbg.yahoo = dbg.yahoo || { attempts: 0, errors: [] }
    }

    // === 🔑 ADD: results[] voor de UI ===
    // We mappen terug naar de originele (mogelijk Binance) symbols
    // Voor d (24h) nemen we CG/Yahoo changePercent; w/m laten we ongemoeid.
    const results = originalSymbols.map(symRaw => {
      const base = toBaseSymbol(symRaw) || symRaw.toUpperCase()
      const q = data.quotes[base]
      return {
        symbol: symRaw,                                 // bv. BTCUSDT
        price: q?.regularMarketPrice ?? null,           // prijs
        d: q?.regularMarketChangePercent ?? null,       // 24h %
        w: null as number | null,                       // laat zoals het was in de UI
        m: null as number | null,
      }
    })

    return res.status(200).json({
      quotes: data.quotes,
      results, // ⬅️ nieuw
      meta: {
        requested: symbols.length,
        received,
        partial,
        errors: data.errors?.length ? data.errors.slice(0,8) : undefined,
        used: `cg-map(${dbg?.path.map})+prices(${dbg?.path.prices})+kv`,
        ...(debug ? { debug: dbg } : {})
      }
    })
  } catch (e:any) {
    if (debug) err(req, 'FATAL handler error', e?.message || e)
    return res.status(200).json({
      quotes: {},
      results: [],
      meta: {
        requested: 0,
        received: 0,
        partial: false,
        errors: [String(e?.message || e)],
        used: 'error',
        ...(debug ? { debug: {
          ...dbg!,
          timings: { ...(dbg?.timings||{}), total_ms: Math.round(time() - t0) },
        }} : {})
      }
    })
  }
}