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
    skipped?: string[]        // ← laten zien wat we genegeerd hebben
    mappedCrypto?: string[]   // ← laten zien wat we als crypto behandeld hebben
  }
}

// ============= kleine in-memory cache voor equities (20s) =============
const CACHE_TTL_MS = 20_000
const mem = new Map<string, { t: number; q: Quote }>()
const setCache = (q: Quote) => { if (q?.symbol) mem.set(q.symbol, { t: Date.now(), q }) }
const getCache = (s: string): Quote | null => {
  const hit = mem.get(s); if (!hit) return null
  return (Date.now() - hit.t <= CACHE_TTL_MS) ? hit.q : null
}

const sleep = (ms:number)=> new Promise(r=>setTimeout(r,ms))
async function okJson<T>(r: Response): Promise<T> { return r.json() as any }

// ============= crypto normalisatie (ids/namen → tickers) =============
const CG_ID_TO_SYM: Record<string,string> = {
  bitcoin:'BTC', ethereum:'ETH', solana:'SOL', binancecoin:'BNB', ripple:'XRP',
  cardano:'ADA', dogecoin:'DOGE', avalanche2:'AVAX', polkadot:'DOT', chainlink:'LINK',
  tron:'TRX', toncoin:'TON', litecoin:'LTC', shiba_inu:'SHIB'
}
const NAME_TO_SYM: Record<string,string> = {
  BITCOIN:'BTC', ETHEREUM:'ETH', SOLANA:'SOL', BINANCE:'BNB', BINANCECOIN:'BNB',
  RIPPLE:'XRP', CARDANO:'ADA', DOGECOIN:'DOGE', AVALANCHE:'AVAX', POLKADOT:'DOT',
  CHAINLINK:'LINK', TRON:'TRX', TON:'TON', TONCOIN:'TON', LITECOIN:'LTC', 'SHIBA INU':'SHIB', SHIBAINU:'SHIB'
}

function parseSymbols(q: string | string[] | undefined): string[] {
  if (!q) return []
  const raw = Array.isArray(q) ? q.join(',') : q
  // filter rommel: lege tokens, “...”, “-”, etc.
  return raw.split(',')
    .map(s => s.trim())
    .filter(s => s && s !== '...' && s !== '-' && s.toLowerCase() !== 'null')
}

function mapCryptoToken(tok: string): string | null {
  const up = tok.toUpperCase()
  // is al een ticker? (BTC/ETH/etc.)
  if (/^[A-Z0-9]{2,6}$/.test(up)) return up

  // CoinGecko id?
  const id = tok.toLowerCase()
  if (CG_ID_TO_SYM[id]) return CG_ID_TO_SYM[id]

  // Naam?
  const norm = up.replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ')
  if (NAME_TO_SYM[norm]) return NAME_TO_SYM[norm]

  return null
}

function decideCryptoRouting(input: string[]) {
  const mapped = input.map(mapCryptoToken).filter(Boolean) as string[]
  const unmapped = input.filter(x => !mapCryptoToken(x))

  // Heuristiek: als we minimaal 1 herkenbare crypto hebben, en de rest ziet er niet
  // duidelijk uit als equity ticker met suffix (AAPL, ABN.AS, etc.), dan behandelen we
  // dit als crypto en negeren we de onherkenbare tokens.
  const looksLikeEquity = (s: string) =>
    /[A-Z]{1,6}\.[A-Z]{1,4}/.test(s.toUpperCase()) || /^[A-Z]{1,6}$/.test(s.toUpperCase())

  const anyCrypto = mapped.length > 0
  const anyEquityish = unmapped.some(looksLikeEquity)

  const treatAsCrypto = anyCrypto && !anyEquityish
  return { treatAsCrypto, mapped, skipped: unmapped }
}

// ============= Yahoo chart fetch (equities) =============
async function yahooChartQuote(symbol: string): Promise<Quote> {
  const combos: Array<[string,string]> = [['1d','1mo'], ['1d','3mo'], ['1wk','1y']]
  const errs: string[] = []
  for (const [interval, range] of combos) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`
    try {
      const r = await fetch(url, { cache:'no-store' })
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
    } catch (e:any) {
      errs.push(`[chart ${interval}/${range}] ${String(e?.message || e)}`)
      await sleep(120)
    }
  }
  throw new Error(errs.join(' | '))
}

async function mapWithPool<T,R>(arr:T[], n:number, fn:(t:T)=>Promise<R>): Promise<R[]> {
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

export const config = { runtime: 'nodejs' }

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  try {
    const raw = parseSymbols(req.query.symbols as any)
    if (!raw.length) return res.status(400).json({ error: 'symbols query param is required (comma-separated)' })

    // 1) Beslis of we crypto moeten doen, en welke tokens we negeren
    const { treatAsCrypto, mapped, skipped } = decideCryptoRouting(raw)

    if (treatAsCrypto) {
      // Proxy naar je zuinige crypto endpoint; negeer onherkenbare tokens
      const symbols = Array.from(new Set(mapped)).slice(0, 60)
      const base = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
      const url = `${base}/api/crypto-light/prices?symbols=${encodeURIComponent(symbols.join(','))}`
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) {
        return res.status(200).json({
          quotes: {},
          meta: {
            requested: raw.length,
            received: 0,
            partial: false,
            used: 'quotes: crypto→prices (error)',
            skipped,
            mappedCrypto: symbols,
          }
        })
      }
      const j = await r.json()
      // verrijk meta
      const meta = (j?.meta || {}) as any
      meta.used = 'quotes: crypto→/api/crypto-light/prices'
      meta.skipped = skipped
      meta.mappedCrypto = symbols
      return res.status(200).json({ quotes: j.quotes || {}, meta })
    }

    // 2) Anders: equity/overige via Yahoo (met korte mem-cache)
    const symbols = Array.from(new Set(raw)).slice(0, 60)
    const hits: Quote[] = []
    const need: string[] = []
    for (const s of symbols) {
      const h = getCache(s)
      if (h) hits.push(h); else need.push(s)
    }

    const errors: string[] = []
    const fetched: Quote[] = need.length
      ? (await mapWithPool(need, 4, async (sym) => {
          try {
            const q = await yahooChartQuote(sym)
            setCache(q)
            return q
          } catch (e:any) {
            errors.push(`${sym}: ${String(e?.message || e)}`)
            return { symbol: sym, regularMarketPrice: null, regularMarketChange: null, regularMarketChangePercent: null } as Quote
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
        errors: errors.length ? errors.slice(0,8) : undefined,
        used: 'quotes: equity→yahoo (with 20s mem-cache)',
      }
    })
  } catch (e:any) {
    return res.status(502).json({ error: String(e?.message || e) })
  }
}