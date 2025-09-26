// src/pages/api/crypto-light/prices.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Binance SYMBOLUSDT -> CoinGecko ID
 * Vul aan met de symbols die je in COINS gebruikt.
 */
const CG_ID: Record<string, string> = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  BNBUSDT: 'binancecoin',
  SOLUSDT: 'solana',
  XRPUSDT: 'ripple',
  ADAUSDT: 'cardano',
  DOGEUSDT: 'dogecoin',
  AVAXUSDT: 'avalanche-2',
  MATICUSDT: 'matic-network',
  DOTUSDT: 'polkadot',
  LINKUSDT: 'chainlink',
  LTCUSDT: 'litecoin',
  BCHUSDT: 'bitcoin-cash',
  TRXUSDT: 'tron',
  NEARUSDT: 'near',
  ATOMUSDT: 'cosmos',
  ARBUSDT: 'arbitrum',
  OPUSDT: 'optimism',
  INJUSDT: 'injective-protocol',
  APTUSDT: 'aptos',
  SUIUSDT: 'sui',
  PEPEUSDT: 'pepe',
  SHIBUSDT: 'shiba-inu',
  ETCUSDT: 'ethereum-classic',
  VETUSDT: 'vechain',
  EGLDUSDT: 'multiversx',
  IMXUSDT: 'immutable-x',
  GRTUSDT: 'the-graph',
  STXUSDT: 'stacks',
  RUNEUSDT: 'thorchain',
  RNDRUSDT: 'render-token',
  AAVEUSDT: 'aave',
  MKRUSDT: 'maker',
  UNIUSDT: 'uniswap',
  // ...meer indien nodig
}

type MarketsRow = {
  id: string
  current_price: number | null
  price_change_percentage_24h_in_currency?: number | null
  price_change_percentage_7d_in_currency?: number | null
  price_change_percentage_30d_in_currency?: number | null
}

/** Split array in chunks */
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbolsParam = String(req.query.symbols || '').trim()
    if (!symbolsParam) return res.status(400).json({ error: 'Missing ?symbols=BTCUSDT,ETHUSDT' })
    const debug = String(req.query.debug || '') === '1'

    const symbols = symbolsParam
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)

    // Map naar CoinGecko IDs, bewaar index voor terug mapping
    const idBySymbol = new Map<string, string>()
    const wantedIds: string[] = []
    for (const sym of symbols) {
      const id = CG_ID[sym]
      if (id) { idBySymbol.set(sym, id); wantedIds.push(id) }
    }
    if (wantedIds.length === 0) {
      return res.status(200).json({ results: symbols.map(sym => ({ symbol: sym, price: null, d: null, w: null, m: null })) })
    }

    // CoinGecko /coins/markets limit is 250 ids per request.
    const apiKey = process.env.COINGECKO_API_KEY || ''
    const headers: Record<string,string> = { 'cache-control': 'no-cache' }
    if (apiKey) headers['x-cg-demo-api-key'] = apiKey

    const chunks = chunk(Array.from(new Set(wantedIds)), 250)
    const urls: string[] = []
    const allRows: MarketsRow[] = []

    for (const ids of chunks) {
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(
        ids.join(',')
      )}&price_change_percentage=24h,7d,30d`
      urls.push(url)
      const r = await fetch(url, { headers })
      if (!r.ok) {
        // Geef iets terug i.p.v. hard failen
        if (debug) {
          return res.status(200).json({
            debug: { urls, status: r.status, text: await r.text() },
            results: symbols.map(sym => ({ symbol: sym, price: null, d: null, w: null, m: null })),
          })
        }
        continue
      }
      const j = (await r.json()) as any[]
      for (const it of j || []) {
        allRows.push({
          id: String(it.id),
          current_price: (it.current_price == null ? null : Number(it.current_price)),
          price_change_percentage_24h_in_currency: numberOrNull(it.price_change_percentage_24h_in_currency),
          price_change_percentage_7d_in_currency: numberOrNull(it.price_change_percentage_7d_in_currency),
          price_change_percentage_30d_in_currency: numberOrNull(it.price_change_percentage_30d_in_currency),
        })
      }
    }

    // Index rows by id
    const rowById = new Map<string, MarketsRow>()
    for (const r of allRows) rowById.set(r.id, r)

    const results = symbols.map(sym => {
      const id = idBySymbol.get(sym)
      const row = id ? rowById.get(id) : undefined
      return {
        symbol: sym,
        price: row?.current_price ?? null,
        d: row?.price_change_percentage_24h_in_currency ?? null,
        w: row?.price_change_percentage_7d_in_currency ?? null,
        m: row?.price_change_percentage_30d_in_currency ?? null,
      }
    })

    if (debug) {
      return res.status(200).json({ debug: { urls, count: allRows.length }, results })
    }

    // 15s edge cache; SWR client heeft daarnaast refreshInterval
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30')
    return res.status(200).json({ results })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}

function numberOrNull(x: any): number | null {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}