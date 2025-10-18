// src/lib/providers/quote.ts

type Range = '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y'
type Interval = '1d'

export type OHLC = { t: number; open: number; high: number; low: number; close: number; volume: number }

const mem = new Map<string, { ts: number; data: OHLC[] }>()
const MEM_TTL_MS = 60_000 // 1 minute in-memory cache

export async function getYahooDailyOHLC(symbol: string, range: Range = '1y', interval: Interval = '1d'): Promise<OHLC[]> {
  const key = `${symbol}:${range}:${interval}`
  const now = Date.now()
  const hit = mem.get(key)
  if (hit && now - hit.ts < MEM_TTL_MS) return hit.data

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`)

  const j = await r.json()
  const res = j?.chart?.result?.[0]
  const ts: number[] = res?.timestamp || []
  const q = res?.indicators?.quote?.[0] || {}
  const opens   = q.open   || []
  const highs   = q.high   || []
  const lows    = q.low    || []
  const closes  = q.close  || []
  const volumes = q.volume || []

  const out: OHLC[] = []
  for (let i = 0; i < ts.length; i++) {
    const o = opens[i], h = highs[i], l = lows[i], c = closes[i], v = volumes[i]
    if ([o,h,l,c,v].every(x => typeof x === 'number' && Number.isFinite(x))) {
      out.push({ t: ts[i] * 1000, open: o, high: h, low: l, close: c, volume: v })
    }
  }

  mem.set(key, { ts: now, data: out })
  return out
}