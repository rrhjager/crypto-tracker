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

// ================= In-memory cache voor equity (20s) =================
const CACHE_TTL_MS = 20_000
const cache = new Map<string, { t: number; q: Quote }>()
const setCache = (q: Quote) => { if (q?.symbol) cache.set(q.symbol, { t: Date.now(), q }) }
const getCache = (sym: string): Quote | null => {
  const h = cache.get(sym)
  if (!h) return null
  return (Date.now() - h.t <= CACHE_TTL_MS) ? h.q : null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function okJson<T>(r: Response): Promise<T> { return r.json() as any }

// ================= Crypto normalisatie (ids/namen → tickers) =================
// Veelvoorkomende CoinGecko ids → tickers
const CG_ID_TO_SYM: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  binancecoin: 'BNB',
  ripple: 'XRP',
  cardano: 'ADA',
  dogecoin: 'DOGE',
  avalanche2: 'AVAX',
  polkadot: 'DOT',
  chainlink: 'LINK',
  tron: 'TRX',
  toncoin: 'TON',
  litecoin: 'LTC',
  shiba_inu: 'SHIB',
  // voeg gerust meer toe als je wilt
}

// Namen/varianten die soms binnenkomen (UI’s die namen ipv tickers sturen)
const NAME_TO_SYM: Record<string, string> = {
  BITCOIN: 'BTC',
  ETHEREUM: 'ETH',
  SOLANA: 'SOL',
  BINANCE: 'BNB',
  BINANCECOIN: 'BNB',
  RIPPLE: 'XRP',
  CARDANO: 'ADA',
  DOGECOIN: 'DOGE',
  AVALANCHE: 'AVAX',
  POLKADOT: 'DOT',
  CHAINLINK: 'LINK',
  TRON: 'TRX',
  TON: 'TON',
  TONCOIN: 'TON',
  LITECOIN: 'LTC',
  'SHIBA INU': 'SHIB',
  SHIBAINU: 'SHIB',
}

// Herken ‘crypto-achtig’ token en map naar ticker (BTC/ETH/…)
// - Tickers (BTC) laat hij door
// - CoinGecko id’s (bitcoin) → BTC
// - Namen (BITCOIN, SOLANA) → BTC/SOL
function toCryptoSym(token: string): string | null {
  const raw = (token || '').trim()
  if (!raw) return null
  // direct ticker?
  const up = raw.toUpperCase()
  if (/^[A-Z0-9]{2,6}$/.test(up)) return up

  // CoinGecko id?
  const id = raw.toLowerCase()
  if (CG_ID_TO_SYM[id]) return CG_ID_TO_SYM[id]

  // Naam?
  const normName = up.replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ')
  if (NAME_TO_SYM[normName]) return NAME_TO_SYM[normName]

  return null
}

function parseSymbols(q: string | string[] | undefined): string[] {
  if (!q) return []
  const raw = Array.isArray(q) ? q.join(',') : q
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

function isLikelyCryptoList(input: string[]): { allCrypto: boolean; mapped: string[] } {
  if (input.length === 0) return { allCrypto: false, mapped: [] }
  const mapped = input.map(toCryptoSym)
  const ok = mapped.every(Boolean)
  return { allCrypto: ok, mapped: (mapped.filter(Boolean) as string[]) }
}

// ================= Yahoo chart (equities/overige) =================
/** Pak laatste en voorlaatste geldige close uit chart API en bereken change/% */
async function fetchQuoteFromChart(symbol: string): Promise<Quote> {
  // chart combos; 1d is vaak robuust
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

      // laatste 2 geldige closes
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

      return {
        symbol,
        longName: meta?.symbol ?? undefined,
        shortName: meta?.symbol ?? undefined,
        regularMarketPrice: last,
        regularMarketChange: change,
        regularMarketChangePercent: changePct,
        currency: meta?.currency ?? undefined,
        marketState: meta?.marketState ?? undefined,
      }
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

// ================= Handler =================
export const config = { runtime: 'nodejs' }

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  try {
    const rawInput = parseSymbols(req.query.symbols as any)
    if (rawInput.length === 0) return res.status(400).json({ error: 'symbols query param is required (comma-separated)' })

    // 1) Als ALLE tokens op crypto lijken → proxy naar lichtgewicht crypto endpoint
    const { allCrypto, mapped } = isLikelyCryptoList(rawInput)
    if (allCrypto && mapped.length) {
      // let alleen jouw domein de call doen; middleware staat /api/crypto-light/prices toe
      const base = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
      const url = `${base}/api/crypto-light/prices?symbols=${encodeURIComponent(mapped.join(','))}`
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) {
        // veilig fallback: geef nette lege response, UI blijft werken
        return res.status(200).json({
          quotes: {},
          meta: { requested: mapped.length, received: 0, partial: false, used: 'quotes: crypto→prices (error)' }
        })
      }
      const j = await r.json()
      // Pas meta.used iets aan voor transparantie
      if (j?.meta) j.meta.used = 'quotes: crypto→/api/crypto-light/prices · equity→yahoo'
      return res.status(200).json(j)
    }

    // 2) Anders: equity/overige → haal via Yahoo chart (met kleine cache)
    const symbols = [...new Set(rawInput)]
    const hits: Quote[] = []
    const need: string[] = []
    for (const s of symbols) {
      const h = getCache(s)
      if (h) hits.push(h)
      else need.push(s)
    }

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
        used: 'quotes: equity→yahoo (with 20s mem-cache)',
      }
    })
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || e) })
  }
}