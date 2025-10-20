import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'

export const config = { runtime: 'nodejs' }

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

/** ===== Config ===== */
const EDGE_S_MAXAGE = 20;           // 20s CDN cache
const EDGE_SWR      = 120;          // 2 min stale-while-revalidate op CDN
const KV_TTL_SEC    = 30;           // 30s KV snapshot (lage latency, laag egress)
const KV_REVALIDATE = 15;           // 15s vóór TTL verversen in bg

// Standaard symbolen op de crypto-homepage (pas aan indien nodig)
const DEFAULT_SYMBOLS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK'
]

// CoinGecko mapping (id → ticker/sym) voor batch call
const CG_ID_MAP: Record<string, string> = {
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
}

// omgekeerde lookup (sym → id)
const CG_SYM_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(CG_ID_MAP).map(([id, sym]) => [sym, id])
)

function parseSymbols(q: string | string[] | undefined): string[] {
  if (!q) return DEFAULT_SYMBOLS
  const raw = Array.isArray(q) ? q.join(',') : q
  const syms = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  // max 60 om misbruik te voorkomen
  return syms.slice(0, 60)
}

/** ===== Helpers ===== */

async function okJson<T>(r: Response): Promise<T> {
  const j = await r.json()
  return j as T
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Yahoo Chart fallback: pakt laatste en voorlaatste close en maakt change/% */
async function yahooQuote(symbolUSD: string): Promise<Quote> {
  // symbolUSD: bijv. BTC-USD, ETH-USD
  const combos: Array<[string, string]> = [
    ['1d', '1mo'],
    ['1d', '3mo'],
    ['1wk', '1y'],
  ]
  const errs: string[] = []
  for (const [interval, range] of combos) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbolUSD)}?interval=${interval}&range=${range}`
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
        symbol: symbolUSD.replace('-USD',''),
        longName: meta?.symbol ?? undefined,
        shortName: meta?.symbol ?? undefined,
        regularMarketPrice: last,
        regularMarketChange: change,
        regularMarketChangePercent: changePct,
        currency: 'USD',
        marketState: meta?.marketState ?? undefined,
      }
    } catch (e: any) {
      errs.push(`[chart ${interval}/${range}] ${String(e?.message || e)}`)
      await sleep(120)
    }
  }
  // alles mislukt
  throw new Error(errs.join(' | '))
}

/** CoinGecko batch → zet om naar Quote-shape */
async function coingeckoBatch(symbols: string[]): Promise<Record<string, Quote>> {
  // Map symbolen die we kennen naar ids
  const ids = symbols.map(s => CG_SYM_TO_ID[s]).filter(Boolean)
  if (!ids.length) return {}

  // één lichte call
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd&include_24hr_change=true`
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`)
  const j: any = await r.json()

  const out: Record<string, Quote> = {}
  for (const [id, payload] of Object.entries(j)) {
    const sym = (CG_ID_MAP[id] || '').toUpperCase()
    if (!sym) continue
    const px = Number(payload?.usd)
    const chgPct = Number(payload?.usd_24h_change)
    const priceOk = Number.isFinite(px)
    const pctOk = Number.isFinite(chgPct)

    // We hebben geen exacte “prev” → change schatten via pct
    const change = (priceOk && pctOk) ? (px * (chgPct / 100)) : null

    out[sym] = {
      symbol: sym,
      regularMarketPrice: priceOk ? px : null,
      regularMarketChange: change,
      regularMarketChangePercent: pctOk ? chgPct : null,
      currency: 'USD',
      marketState: 'REGULAR',
    }
  }
  return out
}

/** Combineer: eerst CoinGecko (batch, zuinig), dan Yahoo fallback voor missende symbols */
async function buildQuotes(symbols: string[]): Promise<{ map: Record<string, Quote>, errors: string[] }> {
  const errors: string[] = []
  let map: Record<string, Quote> = {}

  // 1) batch
  try {
    const cg = await coingeckoBatch(symbols)
    map = { ...cg }
  } catch (e: any) {
    errors.push(`coingecko: ${String(e?.message || e)}`)
  }

  // 2) fallback per symbool dat nog mist
  const missing = symbols.filter(s => !map[s])
  if (missing.length) {
    const limit = 3 // max 3 tegelijk
    let i = 0
    const work = new Array(Math.min(limit, missing.length)).fill(0).map(async () => {
      while (i < missing.length) {
        const idx = i++
        const s = missing[idx]
        try {
          const q = await yahooQuote(`${s}-USD`)
          map[s] = q
        } catch (e: any) {
          errors.push(`${s}: ${String(e?.message || e)}`)
          map[s] = {
            symbol: s,
            regularMarketPrice: null,
            regularMarketChange: null,
            regularMarketChangePercent: null,
            currency: 'USD',
          }
        }
      }
    })
    await Promise.all(work)
  }

  return { map, errors }
}

/** ===== Handler ===== */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp | { error: string }>) {
  // CDN: de meeste hits raken je functie niet
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_S_MAXAGE}, stale-while-revalidate=${EDGE_SWR}`)

  try {
    const symbols = parseSymbols(req.query.symbols as any)
    if (!symbols.length) return res.status(400).json({ error: 'symbols required' })

    // KV key (alleen afhankelijk van symbolenlijst)
    const kvKey = `crypto:prices:v2:${symbols.join(',')}`

    // Serve uit KV of reken & store (kvRefreshIfStale ververst goedkoop op achtergrond)
    const snap = await kvRefreshIfStale<{ quotes: Record<string, Quote>, updatedAt: number }>(
      kvKey,
      KV_TTL_SEC,
      KV_REVALIDATE,
      async () => {
        const { map, errors } = await buildQuotes(symbols)
        const payload = { quotes: map, updatedAt: Date.now(), errors }
        try { await kvSetJSON(kvKey, payload, KV_TTL_SEC) } catch {}
        return payload
      }
    )

    if (snap?.quotes) {
      return res.status(200).json({
        quotes: snap.quotes,
        meta: {
          requested: symbols.length,
          received: Object.values(snap.quotes).filter(q => q.regularMarketPrice != null).length,
          partial: Object.values(snap.quotes).some(q => q.regularMarketPrice == null),
          errors: (snap as any)?.errors?.length ? (snap as any).errors.slice(0,8) : undefined,
          used: 'coingecko+chart-fallback+kv'
        }
      })
    }

    // Eerste keer / fallback
    const { map, errors } = await buildQuotes(symbols)
    try { await kvSetJSON(kvKey, { quotes: map, updatedAt: Date.now(), errors }, KV_TTL_SEC) } catch {}
    return res.status(200).json({
      quotes: map,
      meta: {
        requested: symbols.length,
        received: Object.values(map).filter(q => q.regularMarketPrice != null).length,
        partial: Object.values(map).some(q => q.regularMarketPrice == null),
        errors: errors.length ? errors.slice(0,8) : undefined,
        used: 'coingecko+chart-fallback(fresh)'
      }
    })
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || e) })
  }
}