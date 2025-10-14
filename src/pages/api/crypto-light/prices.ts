// src/pages/api/crypto-light/prices.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { cache5min } from '@/lib/cacheHeaders'
import { kvGetJSON, kvSetJSON, kvRefreshIfStale } from '@/lib/kv'

// Zelfde alias-bron als indicators
const CG_ALIASES: Record<string, string[]> = {
  BTCUSDT: ['bitcoin'],
  ETHUSDT: ['ethereum'],
  BNBUSDT: ['binancecoin'],
  SOLUSDT: ['solana'],
  XRPUSDT: ['ripple'],
  ADAUSDT: ['cardano'],
  DOGEUSDT: ['dogecoin'],
  TRXUSDT: ['tron'],
  TONUSDT: ['toncoin', 'the-open-network'],
  AVAXUSDT: ['avalanche-2'],
  MATICUSDT: ['matic-network'],
  DOTUSDT: ['polkadot'],
  LINKUSDT: ['chainlink'],
  LTCUSDT: ['litecoin'],
  BCHUSDT: ['bitcoin-cash'],
  NEARUSDT: ['near'],
  ATOMUSDT: ['cosmos'],
  ARBUSDT: ['arbitrum'],
  OPUSDT:  ['optimism'],
  INJUSDT: ['injective-protocol'],
  APTUSDT: ['aptos'],
  SUIUSDT: ['sui'],
  SHIBUSDT:['shiba-inu'],
  ETCUSDT: ['ethereum-classic'],
  VETUSDT: ['vechain'],
  EGLDUSDT:['multiversx'],
  IMXUSDT: ['immutable-x'],
  GRTUSDT: ['the-graph'],
  STXUSDT: ['stacks', 'blockstack'],
  RUNEUSDT:['thorchain'],
  RNDRUSDT:['render-token'],
  AAVEUSDT:['aave'],
  MKRUSDT: ['maker'],
  UNIUSDT: ['uniswap'],
  FLOWUSDT: ['flow'],
  CHZUSDT:  ['chiliz'],
  MANAUSDT: ['decentraland'],
  SANDUSDT: ['the-sandbox'],
  AXSUSDT:  ['axie-infinity'],
  DYDXUSDT: ['dydx-chain', 'dydx'],
  KASUSDT:  ['kaspa'],
  SEIUSDT:  ['sei-network', 'sei'],
  BONKUSDT: ['bonk'],
  JASMYUSDT:['jasmycoin'],
  FTMUSDT:  ['fantom'],
  PEPEUSDT: ['pepe'],
  // ---- extra die je ook in indicators gebruikt ----
  ICPUSDT:  ['internet-computer'],
  XLMUSDT:  ['stellar'],
  FILUSDT:  ['filecoin'],
  ALGOUSDT: ['algorand'],
  QNTUSDT:  ['quant', 'quant-network'],
  THETAUSDT:['theta-token'],
}

type MarketsRow = {
  id: string
  current_price: number | null
  price_change_percentage_24h_in_currency?: number | null
  price_change_percentage_7d_in_currency?: number | null
  price_change_percentage_30d_in_currency?: number | null
}

function numberOrNull(x: any): number | null {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function fetchSimplePrice(ids: string[]) {
  if (ids.length === 0) return {}
  const apiKey = process.env.COINGECKO_API_KEY || ''
  const headers: Record<string,string> = { 'cache-control': 'no-cache' }
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd&include_24hr_change=true`
  const r = await fetch(url, { headers })
  if (!r.ok) return {}
  return r.json() as Promise<Record<string, { usd: number, usd_24h_change?: number }>>
}

type MarketChart = { prices: [number, number][] }
async function fetchPerfFromChart(id: string) {
  const apiKey = process.env.COINGECKO_API_KEY || ''
  const headers: Record<string,string> = { 'cache-control': 'no-cache' }
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey

  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=200&interval=daily`
  const r = await fetch(url, { headers })
  if (!r.ok) return { w: null, m: null }
  const j = (await r.json()) as MarketChart
  const closes = (j.prices || []).map(p => Number(p[1])).filter(Number.isFinite)
  const last = closes.at(-1)
  const c7   = closes.at(-8)
  const c30  = closes.at(-31)
  const pct = (a?: number, b?: number) => (a && b) ? ((b - a) / a) * 100 : null
  return { w: pct(c7, last), m: pct(c30, last) }
}

/* ──────────────────────────────────────────────
   SWR/KV settings
   ────────────────────────────────────────────── */
const STALE_MS = 20_000 // ~20s: serve stale-while-revalidate

type PriceRow = { symbol: string; price: number|null; d: number|null; w: number|null; m: number|null }
type Payload = { results: PriceRow[] }

/** Core compute (ongewijzigde logica) */
async function compute(symbols: string[], debug = false) {
  // 1) Eerste poging via eerste alias
  const firstIdBySymbol = new Map<string, string>()
  for (const sym of symbols) {
    const aliases = CG_ALIASES[sym]
    if (aliases?.length) firstIdBySymbol.set(sym, aliases[0])
  }
  const wantedFirstIds = Array.from(new Set(Array.from(firstIdBySymbol.values())))

  const apiKey = process.env.COINGECKO_API_KEY || ''
  const headers: Record<string,string> = { 'cache-control': 'no-cache' }
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey

  const chunks = chunk(wantedFirstIds, 250)
  const marketsRows: MarketsRow[] = []
  const urls: string[] = []

  for (const ids of chunks) {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(','))}&price_change_percentage=24h,7d,30d`
    urls.push(url)
    const r = await fetch(url, { headers })
    if (!r.ok) continue
    const j = (await r.json()) as any[]
    for (const it of j || []) {
      marketsRows.push({
        id: String(it.id),
        current_price: (it.current_price == null ? null : Number(it.current_price)),
        price_change_percentage_24h_in_currency: numberOrNull(it.price_change_percentage_24h_in_currency),
        price_change_percentage_7d_in_currency: numberOrNull(it.price_change_percentage_7d_in_currency),
        price_change_percentage_30d_in_currency: numberOrNull(it.price_change_percentage_30d_in_currency),
      })
    }
  }
  const rowById = new Map<string, MarketsRow>()
  for (const r of marketsRows) rowById.set(r.id, r)

  // 2) Missing → fallback alias + simple/price + market_chart
  const missingSymbols: string[] = []
  for (const sym of symbols) {
    const firstId = firstIdBySymbol.get(sym)
    if (!firstId || !rowById.get(firstId)) missingSymbols.push(sym)
  }

  const fallbackIds: string[] = []
  const chooseFallbackIdForSym = new Map<string, string>()
  for (const sym of missingSymbols) {
    const aliases = (CG_ALIASES[sym] || []).slice(1)
    for (const id of aliases) {
      if (!fallbackIds.includes(id)) {
        fallbackIds.push(id)
        chooseFallbackIdForSym.set(sym, id)
        break
      }
    }
  }

  const sp = await fetchSimplePrice(fallbackIds)

  const perfCache = new Map<string, { w: number|null, m: number|null }>()
  for (const id of fallbackIds) {
    perfCache.set(id, await fetchPerfFromChart(id))
  }

  const results: PriceRow[] = symbols.map((sym) => {
    const firstId = firstIdBySymbol.get(sym)
    const primary = firstId ? rowById.get(firstId) : undefined
    if (primary) {
      return {
        symbol: sym,
        price: primary.current_price ?? null,
        d: primary.price_change_percentage_24h_in_currency ?? null,
        w: primary.price_change_percentage_7d_in_currency ?? null,
        m: primary.price_change_percentage_30d_in_currency ?? null,
      }
    }
    const fbId = chooseFallbackIdForSym.get(sym)
    if (fbId) {
      const spRow = (sp as any)[fbId]
      const perf = perfCache.get(fbId) || { w: null, m: null }
      return {
        symbol: sym,
        price: spRow?.usd ?? null,
        d: spRow?.usd_24h_change ?? null,
        w: perf.w,
        m: perf.m,
      }
    }
    return { symbol: sym, price: null, d: null, w: null, m: null }
  })

  if (debug) {
    return { debug: { urls, markets_count: marketsRows.length, missing: missingSymbols }, results }
  }
  return { results }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // ✅ CDN cache headers (blijven hetzelfde)
    cache5min(res, 300, 1800)

    const symbolsParam = String(req.query.symbols || '').trim()
    if (!symbolsParam) return res.status(400).json({ error: 'Missing ?symbols=BTCUSDT,ETHUSDT' })
    const debug = String(req.query.debug || '') === '1'

    // Normaliseer voor consistente KV-key: trim, uppercase, uniek, gesorteerd
    const symbols = symbolsParam
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)

    const norm = Array.from(new Set(symbols)).sort()
    const kvKey = `cl:prices:v1:${norm.join(',')}`

    // Debug requests → altijd live berekenen (zodat debug-info klopt)
    if (debug) {
      const out = await compute(norm, true)
      return res.status(200).json(out)
    }

    // 1) Razendsnel: snapshot uit KV
    const snap = await kvGetJSON<{ value: Payload; updatedAt: number }>(kvKey)
    if (snap?.value) {
      // 2) SWR: asynchroon refreshen als stale
      kvRefreshIfStale(kvKey, snap.updatedAt, STALE_MS, async () => {
        const value = await compute(norm, false) as Payload
        await kvSetJSON(kvKey, { value, updatedAt: Date.now() })
      }).catch(() => {})

      return res.status(200).json(snap.value)
    }

    // 3) Geen snapshot → live compute + cachen
    const value = await compute(norm, false) as Payload
    await kvSetJSON(kvKey, { value, updatedAt: Date.now() })
    return res.status(200).json(value)
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}