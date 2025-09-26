// bovenaan: runtime laten staan
export const config = { runtime: 'nodejs' }

// src/pages/api/crypto-light/prices.ts
import type { NextApiRequest, NextApiResponse } from 'next'

// Mapping Binance-style symbols -> CoinGecko IDs
const map: Record<string, string> = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  ADAUSDT: 'cardano',
  SOLUSDT: 'solana',
  BNBUSDT: 'binancecoin',
  XRPUSDT: 'ripple',
  DOGEUSDT: 'dogecoin',
  DOTUSDT: 'polkadot',
  MATICUSDT: 'matic-network',
  AVAXUSDT: 'avalanche-2',
  // ... voeg hier jouw andere coins uit COINS toe
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbolsParam = String(req.query.symbols || '').trim()
    if (!symbolsParam) return res.status(400).json({ error: 'Missing ?symbols=BTCUSDT,ETHUSDT' })

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    const ids = symbols.map(sym => map[sym]).filter(Boolean)

    if (ids.length === 0) return res.json({ results: [] })

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_30d_change=true`
    const cg = await fetch(url, { headers: { 'cache-control': 'no-cache' } }).then(r => r.json())

    const results = symbols.map(sym => {
      const id = map[sym]
      const data = id ? cg[id] : null
      return {
        symbol: sym,
        price: data?.usd ?? null,
        d: data?.usd_24h_change ?? null,
        w: data?.usd_7d_change ?? null,
        m: data?.usd_30d_change ?? null,
      }
    })

    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30')
    return res.status(200).json({ results })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}