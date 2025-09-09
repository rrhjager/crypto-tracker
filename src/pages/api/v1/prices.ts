// src/pages/api/v1/prices.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchSafe, okJson } from '@/lib/fetchSafe'

type PricesResp = {
  updatedAt: number
  prices: Record<string, number | null> // bv. { BTC: 63421.12, ETH: 2485.33, ... }
  // debug?: any
}

// Uitzonderingen: mapping van jouw symbols → Binance base symbols
// (nodig wanneer jouw coinlijst afwijkt van Binance tickers)
const BINANCE_SYMBOL_MAP: Record<string, string> = {
  // voorbeeld: 'XBT': 'BTC',
  KASPA: 'KAS', // Kaspa → KASUSDT
}

function toPair(sym: string) {
  const base = (BINANCE_SYMBOL_MAP[sym] || sym).toUpperCase()
  return `${base}USDT`
}

/** Zet korte CDN-vriendelijke cache headers (prod: Vercel/NGINX/CDN). */
function setCacheHeaders(res: NextApiResponse, smaxage = 10, swr = 30) {
  const value = `public, s-maxage=${smaxage}, stale-while-revalidate=${swr}`
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', value)
  res.setHeader('CDN-Cache-Control', value)
  res.setHeader('Vercel-CDN-Cache-Control', value)
  res.setHeader('Timing-Allow-Origin', '*')
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PricesResp | { updatedAt: number; prices: Record<string, number | null> }>
) {
  try {
    // 1) Welke symbols? Prefer ?symbols=BTC,ETH,… ; anders haal uit je eigen /api/v1/coins
    let symbols: string[] = []
    const raw = req.query.symbols
    if (typeof raw === 'string' && raw.trim()) {
      symbols = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    } else {
      // fallback: zelf de coinlijst vragen (zonder warm-up vereist)
      const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || 'localhost:3000'
      const proto = (req.headers['x-forwarded-proto'] as string) || 'http'
      const base = `${proto}://${host}`
      try {
        const r = await fetchSafe(`${base}/api/v1/coins`, { cache: 'no-store' }, 5000, 1)
        const json = await okJson<any>(r)
        const arr = Array.isArray(json?.results) ? json.results : []
        symbols = arr.map((c: any) => String(c.symbol || '').toUpperCase()).filter(Boolean)
      } catch {
        // laat symbols leeg als dit faalt
      }
    }

    if (!symbols.length) {
      setCacheHeaders(res, 5, 15)
      return res.status(200).json({ updatedAt: Date.now(), prices: {} })
    }

    // 2) Eén bulk call naar Binance met ALLE tickers, dan lokaal filteren (gratis & snel)
    const r = await fetchSafe('https://api.binance.com/api/v3/ticker/price', { cache: 'no-store' }, 6000, 1)
    const all = await okJson<Array<{ symbol: string; price: string }>>(r)

    // maak lookup map
    const byPair = new Map<string, number>()
    for (const t of all) {
      const p = Number(t.price)
      if (Number.isFinite(p)) byPair.set(t.symbol.toUpperCase(), p)
    }

    // 3) Bouw output: symbol → prijs van {SYMBOL}USDT (of null als niet bestaat)
    const out: Record<string, number | null> = {}
    for (const s of symbols) {
      const pair = toPair(s)
      out[s] = byPair.get(pair) ?? null
    }

    setCacheHeaders(res, 10, 30) // micro-cache: snel voor eerste bezoek, revalidate op achtergrond
    return res.status(200).json({
      updatedAt: Date.now(),
      prices: out,
      // debug: { countAll: all?.length, asked: symbols, resolvedPairs: symbols.map(s => toPair(s)) }
    })
  } catch {
    // Graceful fallback: nooit 500; client krijgt geldige shape
    setCacheHeaders(res, 5, 20)
    return res.status(200).json({ updatedAt: Date.now(), prices: {} })
  }
}