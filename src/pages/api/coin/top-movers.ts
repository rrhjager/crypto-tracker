// src/pages/api/coin/top-movers.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export const config = { runtime: 'nodejs' }

type CG = {
  symbol: string
  name: string
  price_change_percentage_24h?: number
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd' +
      '&order=market_cap_desc&per_page=200&page=1&price_change_percentage=24h'

    const r = await fetch(url, {
      headers: {
        'accept': 'application/json',
        'user-agent': process.env.SEC_USER_AGENT || 'SignalHub/1.0'
      },
      cache: 'no-store',
    })
    if (!r.ok) throw new Error(`Coingecko HTTP ${r.status}`)
    const arr: CG[] = await r.json()

    const cleaned = arr
      .map(x => ({
        symbol: (x.symbol || '').toUpperCase(),
        name: x.name || '',
        pct: Number(x.price_change_percentage_24h ?? NaN)
      }))
      .filter(x => Number.isFinite(x.pct))

    const sorted = cleaned.sort((a, b) => b.pct - a.pct)
    const gainers = sorted.slice(0, 50)  // ruimer; UI pakt top 5
    const losers  = [...sorted].reverse().slice(0, 50)

    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=600')
    return res.status(200).json({ gainers, losers, hint: 'CoinGecko 24h pct' })
  } catch (e:any) {
    return res.status(200).json({ gainers: [], losers: [], error: String(e?.message || e) })
  }
}