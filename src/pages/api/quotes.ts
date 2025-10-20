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

/* ===== kleine utils ===== */
const okJson = async <T,>(r: Response) => (await r.json()) as T
const sleep = (ms:number)=> new Promise(r=>setTimeout(r,ms))

function parseSymbols(q: string | string[] | undefined): string[] {
  const raw = (Array.isArray(q) ? q.join(',') : (q || '')).trim()
  if (!raw) return []
  return [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, 60)
}

// Heel simpele heuristiek: alles met een beurssuffix ('.AS', '.NS', '.F', etc.) of met een slash/hyphen is equity/overig.
// Pure tickers zoals 'BTC','ETH','SOL' behandelen we als crypto.
function splitCryptoAndEquity(symbols: string[]) {
  const crypto: string[] = []
  const equity: string[] = []
  for (const s of symbols) {
    if (/\./.test(s) || /-|\//.test(s)) equity.push(s)
    else crypto.push(s)
  }
  return { crypto, equity }
}

/* ===== Yahoo chart fallback voor equities ===== */
async function yahooQuote(symbol: string): Promise<Quote> {
  const combos: Array<[string, string]> = [['1d','1mo'], ['1d','3mo'], ['1wk','1y']]
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
      errs.push(`[${symbol} ${interval}/${range}] ${String(e?.message || e)}`)
      await sleep(80)
    }
  }
  return {
    symbol,
    regularMarketPrice: null,
    regularMarketChange: null,
    regularMarketChangePercent: null,
  }
}

/* ===== handler ===== */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  try {
    const symbols = parseSymbols(req.query.symbols as any)
    if (!symbols.length) return res.status(400).json({ error: 'symbols query param is required (comma-separated)' })

    const { crypto, equity } = splitCryptoAndEquity(symbols)
    const errors: string[] = []
    const out: Record<string, Quote> = {}

    // 1) CRYPTO via interne, zuinige endpoint (CG batch + KV), zelfde shape
    if (crypto.length) {
      try {
        // Host bepalen voor interne fetch (werkt op Vercel/functions)
        const host = req.headers.host || 'www.signalhub.tech'
        const proto = host.includes('localhost') ? 'http' : 'https'
        const url = `${proto}://${host}/api/crypto-light/prices?symbols=${encodeURIComponent(crypto.join(','))}`
        const r = await fetch(url, { cache: 'no-store', headers: { 'accept': 'application/json' } })
        if (!r.ok) throw new Error(`crypto-light/prices HTTP ${r.status}`)
        const j = await okJson<{ quotes: Record<string, Quote>; meta?: any }>(r)
        Object.assign(out, j.quotes || {})
        if (j?.meta?.errors?.length) errors.push(...j.meta.errors.slice(0,8))
      } catch (e:any) {
        errors.push(`crypto proxy: ${String(e?.message || e)}`)
        // geen harde fail — laat equity door en crypto blijft leeg; UI blijft stabiel
      }
    }

    // 2) EQUITIES via Yahoo chart fallback (concurrency beperkt)
    if (equity.length) {
      let i = 0
      const limit = 4
      await Promise.all(new Array(Math.min(limit, equity.length)).fill(0).map(async () => {
        while (i < equity.length) {
          const s = equity[i++]
          try {
            const q = await yahooQuote(s)
            out[s] = q
          } catch (e:any) {
            errors.push(`${s}: ${String(e?.message || e)}`)
            out[s] = {
              symbol: s,
              regularMarketPrice: null,
              regularMarketChange: null,
              regularMarketChangePercent: null,
            }
          }
        }
      }))
    }

    const received = Object.values(out).filter(q => q.regularMarketPrice != null).length

    // CDN hints: je API blijft zuinig; frontend haalt veel uit cache/KV
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=120')

    return res.status(200).json({
      quotes: out,
      meta: {
        requested: symbols.length,
        received,
        partial: received < symbols.length,
        errors: errors.length ? errors.slice(0,8) : undefined,
        used: `quotes: crypto→/api/crypto-light/prices · equity→yahoo`,
      }
    })
  } catch (e:any) {
    return res.status(502).json({ error: String(e?.message || e) })
  }
}