// src/pages/api/indicators/ret-batch.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getYahooDailyOHLC, type YahooRange } from '@/lib/providers/quote'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'

type Row = { symbol: string; days: number; pct: number | null }
type Resp = { items: Row[]; updatedAt: number }

const EDGE_MAX_AGE = 30                 // CDN
const KV_TTL = 600                      // 10m per symbool
const KV_REVAL = 120                    // bg refresh window
const RANGE: YahooRange = '6mo'         // voldoende voor 30d

const pct = (from: number, to: number) => (from === 0 ? null : ((to - from) / from) * 100)

async function one(symbol: string, days: 7 | 30): Promise<Row> {
  const key = `ret:${symbol}:${days}`
  const val = await kvRefreshIfStale<Row>(key, KV_TTL, KV_REVAL, async () => {
    const o = await getYahooDailyOHLC(symbol, RANGE)
    const closes: number[] = Array.isArray(o) ? o.map((b: any) => Number(b?.close ?? b?.c)).filter(Number.isFinite)
                          : Array.isArray((o as any)?.closes) ? (o as any).closes.filter(Number.isFinite)
                          : Array.isArray((o as any)?.c) ? (o as any).c.filter(Number.isFinite) : []
    if (closes.length < days + 1) return { symbol, days, pct: null }
    const last = closes.at(-1) as number
    const prev = closes.at(-(days + 1)) as number
    return { symbol, days, pct: pct(prev, last) }
  })
  if (val) return val
  const fresh = await one(symbol, days) // should not happen often
  try { await kvSetJSON(key, fresh, KV_TTL) } catch {}
  return fresh
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_MAX_AGE}, stale-while-revalidate=300`)
  try {
    const symbolsRaw = String(req.query.symbols || '')
    const days = Number(req.query.days)
    if (!symbolsRaw || ![7, 30].includes(days)) {
      return res.status(400).json({ error: 'Usage: ?days=7|30&symbols=A,B,C' })
    }
    const symbols = symbolsRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)

    const out: Row[] = []
    let i = 0
    const CONC = Math.min(6, symbols.length) // laag houden
    await Promise.all(new Array(CONC).fill(0).map(async () => {
      while (true) {
        const idx = i++
        if (idx >= symbols.length) break
        out[idx] = await one(symbols[idx], days as 7 | 30)
      }
    }))

    res.status(200).json({ items: out, updatedAt: Date.now() })
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) })
  }
}