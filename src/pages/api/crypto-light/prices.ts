// src/pages/api/crypto-light/prices.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'

// Zelfde alias-bron als indicators (kopie of import).
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
  STXUSDT: ['stacks'],
  RUNEUSDT:['thorchain'],
  RNDRUSDT:['render-token'],
  AAVEUSDT:['aave'],
  MKRUSDT: ['maker'],
  UNIUSDT: ['uniswap'],
  // extra's uit je screenshot:
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

// Fallback helpers
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
  // voor 7d/30d uit closes
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbolsParam = String(req.query.symbols || '').trim()
    if (!symbolsParam) return res.status(400).json({ error: 'Missing ?symbols=BTCUSDT,ETHUSDT' })
    const debug = String(req.query.debug || '') === '1'

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)

    // 1) Eerste poging: /coins/markets batch op de EERSTE alias van elk symbool
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

    // 2) Voor symbolen zonder row: fallback via andere alias + simple/price + market_chart
    const missingSymbols: string[] = []
    for (const sym of symbols) {
      const firstId = firstIdBySymbol.get(sym)
      if (!firstId || !rowById.get(firstId)) missingSymbols.push(sym)
    }

    // Bouw lijst van fallback-ids (alle aliassen die nog niet gebruikt zijn)
    const fallbackIds: string[] = []
    const chooseFallbackIdForSym = new Map<string, string>()
    for (const sym of missingSymbols) {
      const aliases = (CG_ALIASES[sym] || []).slice(1) // skip first
      for (const id of aliases) {
        // kies de eerste alias die we nog niet geprobeerd hebben
        if (!fallbackIds.includes(id)) {
          fallbackIds.push(id)
          chooseFallbackIdForSym.set(sym, id)
          break
        }
      }
    }

    // Simple price voor fallback ids (alleen price + 24h)
    const sp = await fetchSimplePrice(fallbackIds)

    // 7d/30d via market_chart, on-demand per missende coin
    const perfCache = new Map<string, { w: number|null, m: number|null }>()
    for (const id of fallbackIds) {
      if (!sp[id]) continue // als zelfs simple price niks gaf, probeer alsnog perf (kan ook null terugkomen)
      perfCache.set(id, await fetchPerfFromChart(id))
    }

    // 3) Result samenstellen per symbool
    const results = await Promise.all(symbols.map(async (sym) => {
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
      // fallback
      const fbId = chooseFallbackIdForSym.get(sym)
      if (fbId) {
        const spRow = sp[fbId]
        const perf = perfCache.get(fbId) || { w: null, m: null }
        return {
          symbol: sym,
          price: spRow?.usd ?? null,
          d: spRow?.usd_24h_change ?? null,
          w: perf.w,
          m: perf.m,
        }
      }
      // geen mapping
      return { symbol: sym, price: null, d: null, w: null, m: null }
    }))

    if (debug) {
      return res.status(200).json({ debug: { urls, markets_count: marketsRows.length, missing: missingSymbols }, results })
    }

    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30')
    return res.status(200).json({ results })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}