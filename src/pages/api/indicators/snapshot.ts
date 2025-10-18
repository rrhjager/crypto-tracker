// src/pages/api/indicators/snapshot.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { maCross, rsi14, macd, vol20 } from '@/lib/ta'
import { TTL_SEC } from './_config'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'

export const config = { runtime: 'nodejs' }

type Item = {
  symbol: string
  ma: { ma50: number|null; ma200: number|null; status?: string; points?: number|null|string }
  rsi: { period: number; rsi: number|null; status?: string; points?: number|null|string }
  macd: { fast: number; slow: number; signalPeriod: number; macd: number|null; signal: number|null; hist: number|null; status?: string; points?: number|null|string }
  volume: { period: number; volume: number|null; avg20: number|null; ratio: number|null; status?: string; points?: number|null|string }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbols = String(req.query.symbols || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!symbols.length) return res.status(400).json({ error: 'symbols required' })

    const key = `batch:${symbols.sort().join(',')}`
    const cached = await kvGetJSON<{ items: Item[] }>(key)
    if (cached) return res.status(200).json(cached)

    const items: Item[] = []
    for (const symbol of symbols) {
      const ohlc = await getYahooDailyOHLC(symbol, '1y')
      const closes = ohlc.map(x => x.close)
      const volumes = ohlc.map(x => x.volume)

      const m = maCross(closes)
      const r = rsi14(closes)
      const md = macd(closes, 12, 26, 9)
      const v = vol20(volumes)

      items.push({
        symbol,
        ma: { ma50: m.ma50, ma200: m.ma200, status: m.status, points: m.points },
        rsi: { period: r.period, rsi: r.rsi, status: r.status, points: r.points },
        macd: { fast: md.fast, slow: md.slow, signalPeriod: md.signalPeriod, macd: md.macd, signal: md.signal, hist: md.hist, status: md.status, points: md.points },
        volume: { period: v.period, volume: v.volume, avg20: v.avg20, ratio: v.ratio, status: v.status, points: v.points }
      })
    }

    const payload = { items }
    await kvSetJSON(key, payload, TTL_SEC)
    return res.status(200).json(payload)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}