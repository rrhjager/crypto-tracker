// src/pages/api/crypto-light/prices.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import pLimit from 'p-limit'

type BinanceKline = [
  number, string, string, string, string, string,
  number, string, number, string, string, string
]

async function fetchTicker24h(symbols: string[]) {
  // Binance ondersteunt batch met JSON-array in ?symbols=
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) throw new Error(`Ticker HTTP ${r.status}`)
  const j = await r.json()
  const out = new Map<string, { lastPrice: number, pct24h: number }>()
  for (const t of Array.isArray(j) ? j : []) {
    const s = String(t.symbol)
    out.set(s, { lastPrice: Number(t.lastPrice), pct24h: Number(t.priceChangePercent) })
  }
  return out
}

async function fetchKlines(symbol: string, limit = 40) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=${limit}`
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) throw new Error(`Klines ${symbol} HTTP ${r.status}`)
  const raw = (await r.json()) as BinanceKline[]
  return raw.map(k => Number(k[4])) // close
}

function pct(from?: number|null, to?: number|null) {
  if (from == null || to == null || !isFinite(from) || !isFinite(to) || from === 0) return null
  return ((to - from) / from) * 100
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbolsParam = String(req.query.symbols || '').trim()
    if (!symbolsParam) return res.status(400).json({ error: 'Missing ?symbols=BTCUSDT,ETHUSDT' })
    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)

    // 24h ticker (batch)
    let tmap = new Map<string, { lastPrice: number, pct24h: number }>()
    try { tmap = await fetchTicker24h(symbols) } catch (e) { /* fallback per coin via klines */ }

    // Voor 7d/30d (en eventueel prijs fallback) halen we 31 candles op per symbool
    const limit = pLimit(4)
    const rows = await Promise.all(symbols.map(sym => limit(async () => {
      try {
        const closes = await fetchKlines(sym, 40)
        const last = closes.at(-1)
        const c7   = closes.at(-8)   // 7 volledige dagen terug
        const c30  = closes.at(-31)  // 30 dagen terug

        const tick = tmap.get(sym)
        const price = tick?.lastPrice ?? last ?? null
        const d = (tick?.pct24h != null) ? tick.pct24h : (pct(closes.at(-2), last))
        const w = pct(c7, last)
        const m = pct(c30, last)

        return { symbol: sym, price, d, w, m }
      } catch (e: any) {
        return { symbol: sym, error: e?.message || 'Failed' }
      }
    })))

    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30')
    return res.status(200).json({ results: rows })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}