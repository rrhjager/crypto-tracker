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

const isNum = (v: any): v is number => Number.isFinite(v)
const isValidPrice = (v: any): v is number => Number.isFinite(v) && v > 0

/* ---------------- Yahoo helpers ---------------- */

// Batch: v7 quote endpoint (meest betrouwbaar voor EU/UK/DE/HK)
async function fetchBatchQuotesV7(symbols: string[]): Promise<Record<string, Quote>> {
  // Yahoo kan ~300+ symbols aan; wij sturen jouw set in één batch
  const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`
  const r = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j: any = await r.json()
  const res = j?.quoteResponse?.result ?? []
  const out: Record<string, Quote> = {}

  for (const row of res) {
    const symbol = row?.symbol as string
    if (!symbol) continue

    const price = Number(row?.regularMarketPrice)
    const prev  = Number(row?.regularMarketPreviousClose)
    const change = isValidPrice(price) && isValidPrice(prev) ? price - prev : null
    const pct    = isValidPrice(price) && isValidPrice(prev) && prev !== 0 ? (change as number) / prev * 100 : null

    out[symbol] = {
      symbol,
      longName: row?.longName ?? row?.shortName ?? undefined,
      shortName: row?.shortName ?? undefined,
      regularMarketPrice: isValidPrice(price) ? price : null,
      regularMarketPreviousClose: isValidPrice(prev) ? prev : null,
      regularMarketChange: isNum(change) ? change : null,
      regularMarketChangePercent: isNum(pct) ? pct : null,
      currency: row?.currency ?? undefined,
      marketState: row?.marketState ?? undefined,
    }
  }
  return out
}

// Chart fallback (per symbool) — voor missers of als v7 0/null gaf
async function fetchChart(symbol: string, range: string, interval: string) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
  const r = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j: any = await r.json()
  const res = j?.chart?.result?.[0]
  if (!res) throw new Error('no result')
  return res
}

function lastValid(arr: (number | null | undefined)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i]
    if (isValidPrice(v)) return v as number
  }
  return null
}

function lastAndPrevValid(arr: (number | null | undefined)[]) {
  let last: number | null = null
  let prev: number | null = null
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i]
    if (isValidPrice(v)) {
      if (last == null) last = v as number
      else { prev = v as number; break }
    }
  }
  return { last, prev }
}

async function fetchQuoteFromChart(symbol: string): Promise<Quote> {
  // 1) probeer intraday prijs via 1d/1m
  let price: number | null = null
  let currency: string | undefined
  let marketState: string | undefined
  let longName: string | undefined
  let shortName: string | undefined

  try {
    const res1 = await fetchChart(symbol, '1d', '1m')
    currency = res1?.meta?.currency ?? undefined
    marketState = res1?.meta?.marketState ?? undefined
    longName = res1?.meta?.longName ?? undefined
    shortName = res1?.meta?.symbol ?? undefined

    const closes1m: (number | null | undefined)[] = (res1?.indicators?.quote?.[0]?.close ?? []).map(Number)
    const last1m = lastValid(closes1m)
    const rmp = Number(res1?.meta?.regularMarketPrice)
    price = isValidPrice(last1m) ? last1m : (isValidPrice(rmp) ? rmp : null)
  } catch { /* fallback hieronder */ }

  // 2) prev close via 5d/1d
  let prevClose: number | null = null
  try {
    const res5 = await fetchChart(symbol, '5d', '1d')
    const closes1d: (number | null | undefined)[] = (res5?.indicators?.quote?.[0]?.close ?? []).map(Number)
    const { last, prev } = lastAndPrevValid(closes1d)
    if (isValidPrice(prev)) prevClose = prev!
    else if (isValidPrice(res5?.meta?.chartPreviousClose)) prevClose = Number(res5.meta.chartPreviousClose)
    else if (isValidPrice(res5?.meta?.previousClose)) prevClose = Number(res5.meta.previousClose)
    else if (isValidPrice(last)) prevClose = last!
  } catch { /* ignore */ }

  // 3) change/pct
  const change = (isValidPrice(price) && isValidPrice(prevClose)) ? (price! - prevClose!) : null
  const pct = (isValidPrice(price) && isValidPrice(prevClose) && prevClose! !== 0) ? (change as number) / prevClose! * 100 : null

  return {
    symbol,
    longName,
    shortName,
    regularMarketPrice: isValidPrice(price) ? price! : null,
    regularMarketPreviousClose: isValidPrice(prevClose) ? prevClose! : null,
    regularMarketChange: isNum(change) ? change : null,
    regularMarketChangePercent: isNum(pct) ? pct : null,
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

    const errors: string[] = []
    const fromV7: Record<string, Quote> = need.length ? await fetchBatchQuotesV7(need) : {}

    // 2) bepaal welke symbols nog missen of "0/null" hebben → chart-fallback
    const needFallback: string[] = []
    const primed: Quote[] = []
    for (const s of need) {
      const q = fromV7[s]
      if (!q || !isValidPrice(q.regularMarketPrice) || !isValidPrice(q.regularMarketPreviousClose)) {
        needFallback.push(s)
      } else {
        primed.push(q)
      }
    }

    const viaChart: Quote[] = needFallback.length
      ? (await mapWithPool(needFallback, 4, async (sym) => {
          try {
            const q = await fetchQuoteFromChart(sym)
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
          } finally {
            await sleep(60)
          }
        }))
      : []

    const all = [...hits, ...primed, ...viaChart]

    // 3) harde guard — zet ongeldige “0” naar null zodat UI geen streepjes door foute nullen krijgt
    for (const q of all) {
      if (!isValidPrice(q.regularMarketPrice)) q.regularMarketPrice = null
      if (!isValidPrice(q.regularMarketPreviousClose)) q.regularMarketPreviousClose = null
      if (!(isNum(q.regularMarketChange) && isNum(q.regularMarketPreviousClose))) {
        if (isValidPrice(q.regularMarketPrice) && isValidPrice(q.regularMarketPreviousClose)) {
          const change = q.regularMarketPrice! - q.regularMarketPreviousClose!
          q.regularMarketChange = change
          q.regularMarketChangePercent = q.regularMarketPreviousClose! !== 0 ? (change / q.regularMarketPreviousClose!) * 100 : null
        }
      }
      setCache(q)
    }

    const map: Record<string, Quote> = {}
    for (const q of all) map[q.symbol] = q

    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30')
    return res.status(200).json({
      quotes: map,
      meta: {
        requested: symbols.length,
        received: all.filter(q => isValidPrice(q.regularMarketPrice)).length,
        partial: all.some(q => !isValidPrice(q.regularMarketPrice)),
        errors: errors.length ? errors.slice(0, 8) : undefined,
        used: `v7:quote${needFallback.length ? ' + chart(1m/1d)' : ''}`,
      }
    })
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || e) })
  }
}