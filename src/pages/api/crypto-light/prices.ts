// src/pages/api/crypto-light/prices.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON, kvGetJSON } from '@/lib/kv'

export const config = { runtime: 'nodejs' }

/** ==== CDN / KV settings ==== */
const EDGE_S_MAXAGE = 20
const EDGE_SWR      = 120
const KV_TTL_SEC    = 25      // korte snapshot TTL
const KV_REVALIDATE = 12

// Sym→ID map cache (we serveren stale bij fout)
const MAP_TTL_SEC        = 24 * 60 * 60 // 24h
const MAP_REVALIDATE_SEC = 6  * 60 * 60 // elke ~6h refresh

/** ==== Defaults ==== */
const DEFAULT_SYMBOLS = [
  'BTC','ETH','SOL','BNB','XRP','ADA','DOGE','TON','AVAX','DOT','LINK','TRX','MATIC','SHIB','LTC','BCH'
]

/** ==== Statische fallback CoinGecko symbol→id ==== */
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

/** ==== Helpers ==== */
const okJson = async <T,>(r: Response)=> (await r.json()) as T

function parseSymbols(q: string | string[] | undefined): string[] {
  if (!q) return DEFAULT_SYMBOLS
  const raw = Array.isArray(q) ? q.join(',') : q
  return raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 120)
}

function cgHeaders() {
  const h: Record<string,string> = { 'accept': 'application/json' }
  const key = process.env.COINGECKO_API_KEY || process.env.COINGECKO_PRO_API_KEY
  if (key) h['x-cg-api-key'] = key
  return h
}

/** ==== CoinGecko: dynamische sym→id map (top ~500) ==== */
async function fetchCgTopSymbols(): Promise<Record<string,string>> {
  // 2 pagina’s van 250 → ~500 tickers op marktkap
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
    if (sym && id && !map.has(sym)) map.set(sym, id) // eerste = hoogste mcap
  }
  return Object.fromEntries(map)
}

/** Robuust: vers → stale KV → statisch */
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
  } catch {/* ga door naar stale/static */}

  try {
    const stale: MapSnap | null = await kvGetJSON<MapSnap>(key)
    if (stale?.map && Object.keys(stale.map).length) return stale.map
  } catch {}

  return { ...STATIC_CG_MAP }
}

/** ==== CoinGecko: coins/markets (price + 24h/7d/30d %) ==== */
type CgCoin = {
  id: string
  symbol: string
  current_price: number
  price_change_percentage_24h_in_currency?: number
  price_change_percentage_7d_in_currency?: number
  price_change_percentage_30d_in_currency?: number
}

async function fetchCgMarkets(ids: string[]): Promise<Record<string, CgCoin>> {
  if (!ids.length) return {}
  // coins/markets ondersteunt ids=… + price_change_percentage=…
  const url = `https://api.coingecko.com/api/v3/coins/markets` +
    `?vs_currency=usd&ids=${encodeURIComponent(ids.join(','))}` +
    `&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d,30d`
  const r = await fetch(url, { cache: 'no-store', headers: cgHeaders() })
  if (!r.ok) throw new Error(`CG markets HTTP ${r.status}`)
  const arr = await okJson<any[]>(r)
  const out: Record<string, CgCoin> = {}
  for (const c of arr) {
    const id = String(c?.id || '')
    if (!id) continue
    out[id] = {
      id,
      symbol: String(c?.symbol || '').toUpperCase(),
      current_price: Number(c?.current_price),
      price_change_percentage_24h_in_currency: Number(c?.price_change_percentage_24h_in_currency),
      price_change_percentage_7d_in_currency: Number(c?.price_change_percentage_7d_in_currency),
      price_change_percentage_30d_in_currency: Number(c?.price_change_percentage_30d_in_currency),
    }
  }
  return out
}

/** ==== Builder: maak results [{symbol, price, d, w, m}] ==== */
async function buildResults(symbols: string[]) {
  const symToId = await getCgSymMap()

  // splits: welke hebben we een id voor?
  const covered = symbols.filter(s => !!symToId[s])
  const missing = symbols.filter(s => !symToId[s]) // (desnoods later uitbreiden)

  const ids = covered.map(s => symToId[s])
  let cg: Record<string, CgCoin> = {}
  if (ids.length) {
    // ids kan lang worden; chunk voorzichtig (CG kan lange query aan, maar hou het safe)
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += 120) chunks.push(ids.slice(i, i+120))
    const parts = await Promise.all(chunks.map(fetchCgMarkets))
    for (const part of parts) Object.assign(cg, part)
  }

  // bouw in de volgorde van aangevraagde symbols
  const results = symbols.map(sym => {
    const id = symToId[sym]
    const row = id ? cg[id] : undefined
    const price = Number.isFinite(row?.current_price) ? Number(row!.current_price) : null
    const d = Number.isFinite(row?.price_change_percentage_24h_in_currency!)
      ? Number(row!.price_change_percentage_24h_in_currency) : null
    const w = Number.isFinite(row?.price_change_percentage_7d_in_currency!)
      ? Number(row!.price_change_percentage_7d_in_currency) : null
    const m = Number.isFinite(row?.price_change_percentage_30d_in_currency!)
      ? Number(row!.price_change_percentage_30d_in_currency) : null

    return { symbol: sym, price, d, w, m }
  })

  const meta = {
    requested: symbols.length,
    received: results.filter(r => r.price != null).length,
    missing, // puur informatief
    used: 'coingecko:coins/markets + kv',
  }

  return { results, meta }
}

/** ==== Handler ==== */
export default async function handler(req: NextApiRequest, res: NextApiResponse<
  { results: Array<{symbol:string; price:number|null; d:number|null; w:number|null; m:number|null}>, meta?: any } | { error: string }
>) {
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_S_MAXAGE}, stale-while-revalidate=${EDGE_SWR}`)

  try {
    const symbols = parseSymbols(req.query.symbols as any)
    const kvKey = `crypto:prices:v1:${symbols.join(',')}`

    const snap = await kvRefreshIfStale<{ results: any[]; meta: any; updatedAt: number }>(
      kvKey, KV_TTL_SEC, KV_REVALIDATE,
      async () => {
        const payload = await buildResults(symbols)
        const withTs = { ...payload, updatedAt: Date.now() }
        try { await kvSetJSON(kvKey, withTs, KV_TTL_SEC) } catch {}
        return withTs
      }
    )

    const data = snap || await (async () => {
      const payload = await buildResults(symbols)
      const withTs = { ...payload, updatedAt: Date.now() }
      try { await kvSetJSON(kvKey, withTs, KV_TTL_SEC) } catch {}
      return withTs
    })()

    return res.status(200).json({ results: data.results, meta: data.meta })
  } catch (e:any) {
    return res.status(200).json({ results: [], meta: { error: String(e?.message || e), used: 'error' } })
  }
}