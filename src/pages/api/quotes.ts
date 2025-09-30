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

/* ---------------- utils ---------------- */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Alleen >0 en finite zijn geldig (0 is GEEN geldige prijs/close)
const isValidPos = (v: any) => Number.isFinite(v) && Number(v) > 0

function lastValidPos(arr: (number | null | undefined)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = Number(arr[i])
    if (isValidPos(v)) return v
  }
  return null
}
function lastAndPrevValidPos(arr: (number | null | undefined)[]) {
  let last: number | null = null
  let prev: number | null = null
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = Number(arr[i])
    if (isValidPos(v)) {
      if (last == null) last = v
      else { prev = v; break }
    }
  }
  return { last, prev }
}
function pct(change: number | null, base: number | null): number | null {
  if (!isValidPos(change) || !isValidPos(base) || (base as number) === 0) return null
  return (change as number) / (base as number) * 100
}

/* ---------------- Yahoo helpers ---------------- */
async function fetchChart(symbol: string, range: string, interval: string) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
  const r = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j: any = await r.json()
  const res = j?.chart?.result?.[0]
  if (!res) throw new Error('no result')
  return res
}

/**
 * Robuuste quote:
 * - Live/laatste prijs uit chart(1d/1m): laatste geldige (>0) 1m close
 * - Previous close uit chart(5d/1d): vorige geldige (>0) slotkoers
 * - Fallbacks (alleen als >0): meta.regularMarketPrice, meta.chartPreviousClose, meta.previousClose
 * - Zelf change en percent uitrekenen
 */
async function fetchRobustQuote(symbol: string): Promise<Quote> {
  const errors: string[] = []

  // 1) Live (1d/1m)
  let price: number | null = null
  let currency: string | undefined
  let marketState: string | undefined
  let longName: string | undefined
  let shortName: string | undefined

  try {
    const res1 = await fetchChart(symbol, '1d', '1m')
    currency    = res1?.meta?.currency ?? undefined
    marketState = res1?.meta?.marketState ?? undefined
    longName    = res1?.meta?.longName ?? undefined
    shortName   = res1?.meta?.symbol ?? undefined

    // laatste geldige 1m close
    const closes1m: (number | null | undefined)[] = (res1?.indicators?.quote?.[0]?.close ?? []).map(Number)
    const last1m = lastValidPos(closes1m)
    const rmp = Number(res1?.meta?.regularMarketPrice)
    price = isValidPos(last1m) ? last1m! : (isValidPos(rmp) ? rmp : null)
  } catch (e: any) {
    errors.push(`[1d/1m] ${String(e?.message || e)}`)
  }

  // 2) Previous close (5d/1d)
  let prevClose: number | null = null
  try {
    const res5 = await fetchChart(symbol, '5d', '1d')
    const closes1d: number[] = (res5?.indicators?.quote?.[0]?.close ?? []).map(Number)
    const { last, prev } = lastAndPrevValidPos(closes1d)

    if (isValidPos(prev)) prevClose = prev!
    else if (isValidPos(res5?.meta?.chartPreviousClose)) prevClose = Number(res5.meta.chartPreviousClose)
    else if (isValidPos(res5?.meta?.previousClose))      prevClose = Number(res5.meta.previousClose)
    else if (isValidPos(last))                            prevClose = last!
  } catch (e: any) {
    errors.push(`[5d/1d] ${String(e?.message || e)}`)
  }

  // 3) Change berekenen (alleen als beide geldig >0)
  let change: number | null = null
  let changePct: number | null = null
  if (isValidPos(price) && isValidPos(prevClose)) {
    change = (price as number) - (prevClose as number)
    changePct = pct(change, prevClose)
  }

  return {
    symbol,
    longName,
    shortName,
    regularMarketPrice: isValidPos(price) ? price! : null,
    regularMarketChange: isValidPos(change) ? change! : null,
    regularMarketChangePercent: isValidPos(changePct) ? changePct! : null,
    regularMarketPreviousClose: isValidPos(prevClose) ? prevClose! : null,
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
            // mini-pauze i.v.m. rate-limit
            await sleep(60)
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
        used: 'chart:1d/1m + 5d/1d',
      }
    })
  } catch (e: any) {
    // Zachte fallback i.p.v. 502: geef cache-hits terug als die er zijn
    try {
      const raw = String(req.query.symbols || '').trim()
      const symbols = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))]
      const hits: Record<string, Quote> = {}
      let received = 0
      for (const s of symbols) {
        const h = cache.get(s)
        if (h && (Date.now() - h.t) <= CACHE_TTL_MS) {
          hits[s] = h.q
          received++
        }
      }
      if (received > 0) {
        res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=20')
        return res.status(200).json({
          quotes: hits,
          meta: {
            requested: symbols.length,
            received,
            partial: received < symbols.length,
            errors: [String(e?.message || e)],
            used: 'cache:fallback',
          }
        })
      }
    } catch { /* ignore */ }

    // echt niets bruikbaars
    return res.status(502).json({ error: String(e?.message || e) })
  }
}