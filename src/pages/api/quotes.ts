// src/pages/api/quotes.ts
import type { NextApiRequest, NextApiResponse } from 'next'

type Quote = {
  symbol: string
  longName?: string
  shortName?: string
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  currency?: string
  marketState?: string
}

type Resp = {
  quotes: Record<string, Quote>
  meta?: {
    requested: number
    received: number
    partial: boolean
    errors?: string[]
    used: string
  }
}

const CACHE_TTL_MS = 20_000
const cache = new Map<string, { t: number; q: Quote }>()

function setCache(q: Quote) { if (q?.symbol) cache.set(q.symbol, { t: Date.now(), q }) }
function getCache(sym: string): Quote | null {
  const hit = cache.get(sym); if (!hit) return null
  return (Date.now() - hit.t > CACHE_TTL_MS) ? null : hit.q
}

async function okJson<T>(r: Response): Promise<T> { return await r.json() as T }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// --- NEW: map “BTC” → “BTC-USD” (maar laat ABN.AS, AAPL, EURUSD=X etc. met rust)
const CRYPTO_TICKERS = new Set([
  'BTC','ETH','SOL','XRP','ADA','DOGE','AVAX','BNB','MATIC','DOT','LINK','LTC','TRX','ATOM','ETC','XMR','FIL','NEAR'
])
function mapToYahooSymbol(input: string): string {
  const s = (input || '').toUpperCase().trim()
  // Als het al een pair of exchange-symbool is, laat staan
  if (s.includes('-') || s.includes('.') || s.endsWith('=X')) return s
  // Bekende bare crypto tickers -> USD-paar
  if (CRYPTO_TICKERS.has(s)) return `${s}-USD`
  // Heuristiek: 2-6 letters/cijfers zonder suffix => waarschijnlijk crypto → -USD
  if (/^[A-Z0-9]{2,6}$/.test(s)) return `${s}-USD`
  return s
}

/** Pak laatste en voorlaatste geldige close uit chart API en bereken change/% */
async function fetchQuoteFromChart(symbolInput: string): Promise<Quote> {
  const symbol = mapToYahooSymbol(symbolInput)

  const combos: Array<[string, string]> = [
    ['1d', '1mo'],
    ['1d', '3mo'],
    ['1wk', '1y'],
  ]
  const errs: string[] = []
  for (const [interval, range] of combos) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j: any = await okJson(r)
      const res = j?.chart?.result?.[0]
      const meta = res?.meta || {}
      const series = res?.indicators?.quote?.[0] || {}
      const closes: number[] = (series.close || []).map(Number)

      let last: number | null = null
      let prev: number | null = null
      for (let i = closes.length - 1; i >= 0; i--) {
        const v = closes[i]
        if (Number.isFinite(v)) {
          if (last == null) last = v
          else { prev = v; break }
        }
      }
      if (last == null) throw new Error('no closes')

      const change = prev != null ? last - prev : null
      const changePct = prev != null && prev !== 0 ? (change as number) / prev * 100 : null

      const q: Quote = {
        symbol: symbolInput,            // ← geef originele symbool terug als key
        longName: meta?.longName ?? undefined,
        shortName: meta?.symbol ?? undefined,
        regularMarketPrice: last,
        regularMarketChange: change,
        regularMarketChangePercent: changePct,
        currency: meta?.currency ?? undefined,
        marketState: meta?.marketState ?? undefined,
      }
      return q
    } catch (e: any) {
      errs.push(`[chart ${interval}/${range}] ${String(e?.message || e)}`)
      await sleep(120)
    }
  }
  throw new Error(errs.join(' | '))
}

/** Concurrency–limiter: max N tegelijk */
async function mapWithPool<T, R>(arr: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length) as any
  let i = 0
  const workers = new Array(Math.min(n, arr.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++
      if (idx >= arr.length) break
      out[idx] = await fn(arr[idx])
    }
  })
  await Promise.all(workers)
  return out
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  // CDN/edge cache: veel hits raken je functie dan niet
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')

  try {
    const raw = String(req.query.symbols || '').trim()
    if (!raw) return res.status(400).json({ error: 'symbols query param is required (comma-separated)' })

    const symbols = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))]
    if (symbols.length === 0) return res.status(400).json({ error: 'No symbols provided' })

    // 1) cache hits
    const hits: Quote[] = []
    const need: string[] = []
    for (const s of symbols) {
      const h = getCache(s)
      if (h) hits.push(h)
      else need.push(s)
    }

    // 2) haal ontbrekende via chart op, met beperkte paralleliteit
    const errors: string[] = []
    const fetched: Quote[] = need.length
      ? (await mapWithPool(need, 4, async (sym) => {
          try {
            const q = await fetchQuoteFromChart(sym)
            setCache(q)
            return q
          } catch (e: any) {
            errors.push(`${sym}: ${String(e?.message || e)}`)
            return {
              symbol: sym,
              regularMarketPrice: null,
              regularMarketChange: null,
              regularMarketChangePercent: null,
            } as Quote
          }
        }))
      : []

    const all = [...hits, ...fetched]
    const map: Record<string, Quote> = {}
    for (const q of all) map[q.symbol] = q

    return res.status(200).json({
      quotes: map,
      meta: {
        requested: symbols.length,
        received: all.filter(q => q.regularMarketPrice != null).length,
        partial: all.some(q => q.regularMarketPrice == null),
        errors: errors.length ? errors.slice(0, 8) : undefined,
        used: 'chart:v8',
      }
    })
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || e) })
  }
}