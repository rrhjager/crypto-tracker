// src/pages/api/quotes.ts
import type { NextApiRequest, NextApiResponse } from 'next'

type Quote = {
  symbol: string
  longName?: string
  shortName?: string
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  regularMarketPreviousClose?: number | null
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

/* ---------------- in-memory cache (20s) ---------------- */
const CACHE_TTL_MS = 20_000
const cache = new Map<string, { t: number; q: Quote }>()
const setCache = (q: Quote) => { if (q?.symbol) cache.set(q.symbol, { t: Date.now(), q }) }
const getCache = (sym: string): Quote | null => {
  const hit = cache.get(sym)
  if (!hit) return null
  if (Date.now() - hit.t > CACHE_TTL_MS) return null
  return hit.q
}

/* ---------------- helpers ---------------- */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const isNum = (v: any): v is number => typeof v === 'number' && Number.isFinite(v)

function lastValid<T>(arr: (T | null | undefined)[]): T | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i]
    if (v != null && Number.isFinite(v as any)) return v as any
  }
  return null
}
function lastAndPrevValid(arr: (number | null | undefined)[]) {
  let last: number | null = null
  let prev: number | null = null
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i]
    if (Number.isFinite(v)) {
      if (last == null) last = v as number
      else { prev = v as number; break }
    }
  }
  return { last, prev }
}
const pct = (change: number | null, base: number | null) =>
  (isNum(change) && isNum(base) && base !== 0) ? (change / base) * 100 : null

/* ---------------- Yahoo callers ---------------- */
async function fetchChart(symbol: string, range: string, interval: string) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
  const r = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j: any = await r.json()
  const res = j?.chart?.result?.[0]
  if (!res) throw new Error('no result')
  return res
}

// Lightweight fallback dat wereldwijd vaak werkt (ook .L, .DE, .HK, …)
async function fetchQuoteV7(symbol: string) {
  const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`
  const r = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j: any = await r.json()
  const row = j?.quoteResponse?.result?.[0]
  if (!row) throw new Error('no quote result')
  return {
    price: isNum(row.regularMarketPrice) ? row.regularMarketPrice as number : null,
    prevClose: isNum(row.regularMarketPreviousClose) ? row.regularMarketPreviousClose as number : null,
    longName: (row.longName || row.displayName || undefined) as string | undefined,
    shortName: (row.symbol || undefined) as string | undefined,
    currency: (row.currency || undefined) as string | undefined,
    marketState: (row.marketState || undefined) as string | undefined,
  }
}

/**
 * Robuuste quote:
 * - Probeer prijs uit chart (1d/1m), prevClose uit chart (5d/1d)
 * - Vul ontbrekende velden aan via v7/quote
 * - Reken change/% zelf uit zodra beide getallen er zijn
 */
async function fetchRobustQuote(symbol: string): Promise<Quote> {
  let price: number | null = null
  let prevClose: number | null = null
  let longName: string | undefined
  let shortName: string | undefined
  let currency: string | undefined
  let marketState: string | undefined

  const errors: string[] = []

  // 1) Primair via chart
  try {
    const res1 = await fetchChart(symbol, '1d', '1m')
    currency = res1?.meta?.currency ?? currency
    marketState = res1?.meta?.marketState ?? marketState
    longName = res1?.meta?.longName ?? longName
    shortName = res1?.meta?.symbol ?? shortName

    const closes1m: (number | null | undefined)[] = (res1?.indicators?.quote?.[0]?.close ?? []).map(Number)
    const last1m = lastValid<number>(closes1m)
    const rmp = isNum(res1?.meta?.regularMarketPrice) ? Number(res1.meta.regularMarketPrice) : null
    price = isNum(last1m) ? last1m : rmp
  } catch (e: any) {
    errors.push(`[chart 1d/1m] ${String(e?.message || e)}`)
  }

  try {
    const res5 = await fetchChart(symbol, '5d', '1d')
    const closes1d: number[] = (res5?.indicators?.quote?.[0]?.close ?? []).map(Number)
    const { last, prev } = lastAndPrevValid(closes1d)
    if (prev != null) prevClose = prev
    else if (isNum(res5?.meta?.chartPreviousClose)) prevClose = Number(res5.meta.chartPreviousClose)
    else if (isNum(res5?.meta?.previousClose)) prevClose = Number(res5.meta.previousClose)
    else if (last != null) prevClose = last
  } catch (e: any) {
    errors.push(`[chart 5d/1d] ${String(e?.message || e)}`)
  }

  // 2) Fallback / aanvulling via v7/quote
  if (!isNum(price) || !isNum(prevClose) || !currency || !shortName || !longName) {
    try {
      const q7 = await fetchQuoteV7(symbol)
      if (!isNum(price) && isNum(q7.price)) price = q7.price
      if (!isNum(prevClose) && isNum(q7.prevClose)) prevClose = q7.prevClose
      currency = currency || q7.currency
      marketState = marketState || q7.marketState
      longName = longName || q7.longName
      shortName = shortName || q7.shortName
    } catch (e: any) {
      errors.push(`[v7/quote] ${String(e?.message || e)}`)
    }
  }

  // 3) Change en % altijd zelf rekenen zodra we 2 getallen hebben
  const change = (isNum(price) && isNum(prevClose)) ? (price! - prevClose!) : null
  const changePct = pct(change, prevClose)

  return {
    symbol,
    longName,
    shortName,
    regularMarketPrice: isNum(price) ? price! : null,
    regularMarketPreviousClose: isNum(prevClose) ? prevClose! : null,
    regularMarketChange: isNum(change) ? change! : null,
    regularMarketChangePercent: isNum(changePct) ? changePct! : null,
    currency,
    marketState,
  }
}

/* ---------------- small pool limiter ---------------- */
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

/* ---------------- handler ---------------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
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

    // 2) fetch missende met pool
    const errors: string[] = []
    const fetched: Quote[] = need.length
      ? (await mapWithPool(need, 4, async (sym) => {
          try {
            const q = await fetchRobustQuote(sym)
            setCache(q)
            // kleine pauze ivm rate-limits
            await sleep(60)
            return q
          } catch (e: any) {
            errors.push(`${sym}: ${String(e?.message || e)}`)
            return {
              symbol: sym,
              regularMarketPrice: null,
              regularMarketChange: null,
              regularMarketChangePercent: null,
              regularMarketPreviousClose: null,
            } as Quote
          }
        }))
      : []

    const all = [...hits, ...fetched]
    const map: Record<string, Quote> = {}
    for (const q of all) map[q.symbol] = q

    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30')
    return res.status(200).json({
      quotes: map,
      meta: {
        requested: symbols.length,
        received: all.filter(q => q.regularMarketPrice != null).length,
        partial: all.some(q => q.regularMarketPrice == null),
        errors: errors.length ? errors.slice(0, 8) : undefined,
        used: 'chart(1d/1m + 5d/1d) + quote(v7)',
      }
    })
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || e) })
  }
}