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
  regularMarketPreviousClose?: number | null
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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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
function pct(change: number | null, base: number | null): number | null {
  if (!Number.isFinite(change as number) || !Number.isFinite(base as number) || (base as number) === 0) return null
  return (change as number) / (base as number) * 100
}

/* ---------------- Yahoo helpers ---------------- */
async function fetchJSON(url: string) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

async function fetchQuoteSummaryPrice(symbol: string) {
  // quoteSummary heeft vaak consistent previousClose wereldwijd
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/` +
    `${encodeURIComponent(symbol)}?modules=price&lang=en-US&region=US`
  const j: any = await fetchJSON(url)
  const price = j?.quoteSummary?.result?.[0]?.price
  if (!price) throw new Error('no price module')
  return {
    price: Number.isFinite(price.regularMarketPrice?.raw) ? Number(price.regularMarketPrice.raw) : null,
    previousClose: Number.isFinite(price.regularMarketPreviousClose?.raw) ? Number(price.regularMarketPreviousClose.raw)
                   : Number.isFinite(price.preMarketPreviousClose?.raw) ? Number(price.preMarketPreviousClose.raw)
                   : Number.isFinite(price.previousClose?.raw) ? Number(price.previousClose.raw)
                   : null,
    currency: price.currency ?? undefined,
    marketState: price.marketState ?? undefined,
    longName: price.longName ?? undefined,
    shortName: price.symbol ?? undefined,
  }
}

async function fetchChart(symbol: string, range: string, interval: string) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&lang=en-US&region=US&includePrePost=false`
  const j: any = await fetchJSON(url)
  const res = j?.chart?.result?.[0]
  if (!res) throw new Error('no result')
  return res
}

/**
 * Hybride strategie:
 * 1) Haal price/previousClose uit quoteSummary:price (wereldwijd stabieler).
 * 2) Vul aan met chart:
 *    - live prijs uit 1d/1m (laatste geldige 1m close) als price ontbreekt
 *    - vorige close uit 5d/1d als previousClose ontbreekt
 * 3) Bereken change/% met harde guards.
 */
async function fetchRobustQuote(symbol: string): Promise<Quote> {
  let price: number | null = null
  let prevClose: number | null = null
  let currency: string | undefined
  let marketState: string | undefined
  let longName: string | undefined
  let shortName: string | undefined

  const errs: string[] = []

  // 1) quoteSummary
  try {
    const ps = await fetchQuoteSummaryPrice(symbol)
    price = ps.price ?? null
    prevClose = ps.previousClose ?? null
    currency = ps.currency
    marketState = ps.marketState
    longName = ps.longName
    shortName = ps.shortName
  } catch (e: any) {
    errs.push(`[quoteSummary] ${String(e?.message || e)}`)
  }

  // 2a) live prijs (chart 1d/1m) als nodig
  if (!Number.isFinite(price as number)) {
    try {
      const c = await fetchChart(symbol, '1d', '1m')
      const closes1m: (number | null | undefined)[] = (c?.indicators?.quote?.[0]?.close ?? []).map(Number)
      price = lastValid<number>(closes1m)
      if (!Number.isFinite(price as number) && Number.isFinite(c?.meta?.regularMarketPrice))
        price = Number(c.meta.regularMarketPrice)
      if (!currency) currency = c?.meta?.currency ?? undefined
      if (!marketState) marketState = c?.meta?.marketState ?? undefined
      if (!shortName) shortName = c?.meta?.symbol ?? undefined
    } catch (e: any) {
      errs.push(`[chart 1d/1m] ${String(e?.message || e)}`)
    }
  }

  // 2b) vorige close (chart 5d/1d) als nodig
  if (!Number.isFinite(prevClose as number)) {
    try {
      const c5 = await fetchChart(symbol, '5d', '1d')
      const closes1d: number[] = (c5?.indicators?.quote?.[0]?.close ?? []).map(Number)
      const { last, prev } = lastAndPrevValid(closes1d)
      if (prev != null) prevClose = prev
      else if (Number.isFinite(c5?.meta?.chartPreviousClose)) prevClose = Number(c5.meta.chartPreviousClose)
      else if (Number.isFinite(c5?.meta?.previousClose)) prevClose = Number(c5.meta.previousClose)
      else if (last != null) prevClose = last
      if (!currency) currency = c5?.meta?.currency ?? undefined
      if (!shortName) shortName = c5?.meta?.symbol ?? undefined
    } catch (e: any) {
      errs.push(`[chart 5d/1d] ${String(e?.message || e)}`)
    }
  }

  // 3) change berekenen — nooit meer "price == change"
  let change: number | null = null
  let changePct: number | null = null
  if (Number.isFinite(price as number) && Number.isFinite(prevClose as number)) {
    change = (price as number) - (prevClose as number)
    changePct = pct(change, prevClose)
  } else {
    change = null
    changePct = null
  }

  return {
    symbol,
    longName,
    shortName,
    regularMarketPrice: Number.isFinite(price as number) ? price! : null,
    regularMarketPreviousClose: Number.isFinite(prevClose as number) ? prevClose! : null,
    regularMarketChange: Number.isFinite(change as number) ? change! : null,
    regularMarketChangePercent: Number.isFinite(changePct as number) ? changePct! : null,
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
            await sleep(60) // beetje beleefd voor rate limits
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

    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30')
    return res.status(200).json({
      quotes: map,
      meta: {
        requested: symbols.length,
        received: all.filter(q => q.regularMarketPrice != null).length,
        partial: all.some(q => q.regularMarketPrice == null),
        errors: errors.length ? errors.slice(0, 8) : undefined,
        used: 'quoteSummary:price + chart(1d/1m,5d/1d)',
      }
    })
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || e) })
  }
}