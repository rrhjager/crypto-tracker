// bovenaan het bestand
export const config = { runtime: 'nodejs' }

// src/pages/api/crypto-light/indicators.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import pLimit from 'p-limit'
import { sma, rsi, macd, avgVolume } from '@/lib/ta-light'

type BinanceKline = [
  number, string, string, string, string, string,
  number, string, number, string, string, string
]

async function fetchKlines(symbol: string, interval = '1d', limit = 300) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) throw new Error(`Binance ${symbol} HTTP ${r.status}`)
  const raw = (await r.json()) as BinanceKline[]
  return raw.map(k => ({
    time: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }))
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbolsParam = String(req.query.symbols || '').trim()
    if (!symbolsParam) return res.status(400).json({ error: 'Missing ?symbols=BTCUSDT,ETHUSDT' })
    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)

    const limit = pLimit(4)
    const results = await Promise.all(symbols.map(sym => limit(async () => {
      try {
        const candles = await fetchKlines(sym, '1d', 300)
        const closes = candles.map(c => c.close)
        const volumes = candles.map(c => c.volume)
        const last = candles.at(-1)

        const ma50 = sma(closes, 50)
        const ma200 = sma(closes, 200)
        let cross: 'Golden Cross' | 'Death Cross' | '—' = '—'
        if (ma50 != null && ma200 != null) cross = ma50 > ma200 ? 'Golden Cross' : ma50 < ma200 ? 'Death Cross' : '—'

        const rsi14 = rsi(closes, 14)
        const macdVals = macd(closes, 12, 26, 9)

        const vol = last?.volume ?? null
        const volAvg20 = avgVolume(volumes, 20)
        const volRatio = (vol != null && volAvg20 != null && volAvg20 > 0) ? (vol / volAvg20) : null

        return {
          symbol: sym,
          ma: { ma50, ma200, cross },
          rsi: rsi14,
          macd: macdVals,
          volume: { volume: vol, avg20d: volAvg20, ratio: volRatio },
        }
      } catch (e: any) {
        return { symbol: sym, error: e?.message || 'Failed' }
      }
    })))

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
    return res.status(200).json({ results })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}