// src/pages/api/home/snapshot.ts
import type { NextApiRequest, NextApiResponse } from 'next'

import { COINS as COIN_LIST, yahooSymbol } from '@/lib/coins' // 👈 jouw centrale coin-lijst

export const config = { runtime: 'nodejs' }

type Advice = 'BUY' | 'HOLD' | 'SELL'
type NewsIn = { title: string; link: string; source?: string; pubDate?: string }
type NewsOut = { title: string; url: string; source?: string; published?: string; image?: string | null }

type SnapItem = {
  symbol: string   // verwacht Yahoo-style (bv. BTC-USD) van /api/indicators/snapshot
  score?: number | null
}

type IndicatorsSnapshotResp = { items: SnapItem[] }

type CongressTrade = {
  person?: string; ticker?: string; side?: 'BUY'|'SELL'|string;
  amount?: string|number; price?: string|number|null; date?: string; url?: string;
}

type ScoredCoin = { symbol: string; name: string; score: number; signal: Advice }

type HomeSnapshot = {
  newsCrypto: NewsOut[];
  newsEq: NewsOut[];
  // equities topBuy/topSell blijven leeg; homepage rekent die exact client-side per markt
  topBuy: any[];
  topSell: any[];
  coinTopBuy: ScoredCoin[];
  coinTopSell: ScoredCoin[];
  academy: { title: string; href: string }[];
  congress: CongressTrade[];
}

const TTL_S = 300
const CRYPTO_BATCH = 25

// Klein hulpsetje voor status → label
const statusFromScore = (score: number): Advice => (score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD')

// Pool helper (concurrency)
async function pool<T, R>(arr: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length) as any
  let i = 0
  const workers = new Array(Math.min(size, arr.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++
      if (idx >= arr.length) break
      out[idx] = await fn(arr[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

// Base URL afleiden (werkt lokaal, Vercel, proxy)
function baseUrl(req: NextApiRequest) {
  const envBase = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '')
  if (envBase) return envBase
  const proto = (req.headers['x-forwarded-proto'] as string) || 'http'
  const host = req.headers.host
  return `${proto}://${host}`
}

/** News via je eigen Google endpoint */
async function fetchNews(req: NextApiRequest, query: string): Promise<NewsOut[]> {
  const url = `${baseUrl(req)}/api/news/google?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return []
    const j = await r.json() as { items?: NewsIn[] }
    return (j.items || []).slice(0, 6).map((x) => ({
      title: x.title || '',
      url: (x as any).link,
      source: x.source || '',
      published: x.pubDate || '',
      image: null,
    }))
  } catch { return [] }
}

/** Academy */
async function fetchAcademy(req: NextApiRequest) {
  try {
    const r = await fetch(`${baseUrl(req)}/api/academy/list`, { cache: 'no-store' })
    if (!r.ok) return []
    const j = await r.json() as { items?: { title: string; href: string }[] }
    return (j.items || []).slice(0, 8)
  } catch { return [] }
}

/** Congress */
async function fetchCongress(req: NextApiRequest): Promise<CongressTrade[]> {
  try {
    const r = await fetch(`${baseUrl(req)}/api/market/congress?limit=30`, { cache: 'no-store' })
    if (!r.ok) return []
    const j = await r.json() as { items?: any[] }
    const arr = Array.isArray(j?.items) ? j.items : []
    const toISO = (raw?: string|null) => {
      if (!raw) return ''
      if (/\b\d{4}-\d{2}-\d{2}\b/.test(raw)) return raw.slice(0, 10)
      const ts = Date.parse(raw); return Number.isNaN(ts) ? '' : new Date(ts).toISOString().slice(0, 10)
    }
    const norm: CongressTrade[] = arr.map((x: any) => ({
      person: x.person || '', ticker: x.ticker || '', side: String(x.side || '').toUpperCase(),
      amount: x.amount || '', price: x.price ?? null, date: x.publishedISO || x.tradedISO || toISO(x.published || x.traded || x.date) || '', url: x.url || ''
    }))
    norm.sort((a,b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0))
    return norm
  } catch { return [] }
}

/** Server-side CRYPTO toplists
 *  Belangrijk:
 *  - we gebruiken ALLEEN coins uit lib/coins.ts
 *  - voor /api/indicators/snapshot mappen we naar Yahoo symbols (BTC → BTC-USD)
 *  - we mappen scores terug naar basis-symbool (BTC) voor je routes/UX
 */
async function computeCryptoServerSide(req: NextApiRequest) {
  // 1) Bouw Yahoo-symbols lijst vanuit jouw basislijst
  const yahooSymbols = COIN_LIST.map(c => yahooSymbol(c.symbol)) // bv. BTC -> BTC-USD

  // 2) Batches maken
  const batches: string[][] = []
  for (let i = 0; i < yahooSymbols.length; i += CRYPTO_BATCH) {
    batches.push(yahooSymbols.slice(i, i + CRYPTO_BATCH))
  }

  // 3) Fetch helper per batch
  async function fetchBatch(chunk: string[]): Promise<IndicatorsSnapshotResp> {
    const url = `${baseUrl(req)}/api/indicators/snapshot?symbols=${encodeURIComponent(chunk.join(','))}`
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return { items: [] }
    return (await r.json()) as IndicatorsSnapshotResp
  }

  // 4) Parallel ophalen (pool 3)
  const results = await pool(batches, 3, fetchBatch)

  // 5) Score-map vullen (key = Yahoo-symbol)
  const scoreByYahoo = new Map<string, number>()
  for (const res of results) {
    for (const it of (res.items || [])) {
      if (Number.isFinite(it?.score as number)) {
        scoreByYahoo.set(it.symbol, Math.round(Number(it.score)))
      }
    }
  }

  // 6) Terug mappen naar jouw basislijst (BTC, ETH, ...)
  const rows = COIN_LIST
    .map(c => {
      const y = yahooSymbol(c.symbol) // bv. BTC-USD
      const s = scoreByYahoo.get(y)
      return Number.isFinite(s) ? { symbol: c.symbol, name: c.name, score: s as number } : null
    })
    .filter(Boolean) as { symbol: string; name: string; score: number }[]

  // 7) Sorteren en top 5 BUY/SELL
  const desc = [...rows].sort((a,b)=> b.score - a.score)
  const asc  = [...rows].sort((a,b)=> a.score - b.score)

  const coinTopBuy: ScoredCoin[]  = desc.slice(0, 5).map(r => ({ ...r, signal: statusFromScore(r.score) }))
  const coinTopSell: ScoredCoin[] = asc .slice(0, 5).map(r => ({ ...r, signal: statusFromScore(r.score) }))

  return { coinTopBuy, coinTopSell }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<HomeSnapshot | { error: string }>) {
  try {
    const [newsCrypto, newsEq, academy, congress, crypto] = await Promise.all([
      fetchNews(req, 'crypto OR bitcoin OR ethereum OR blockchain'),
      fetchNews(req, 'equities OR stocks OR stock market OR aandelen OR beurs'),
      fetchAcademy(req),
      fetchCongress(req),
      computeCryptoServerSide(req),
    ])

    const snapshot: HomeSnapshot = {
      newsCrypto,
      newsEq,
      topBuy: [],
      topSell: [],
      coinTopBuy: crypto.coinTopBuy,   // ⬅️ basis-symbool (BTC/ETH/...)
      coinTopSell: crypto.coinTopSell, // ⬅️ basis-symbool (BTC/ETH/...)
      academy,
      congress,
    }

    // korte CDN-cache; ISR van index.tsx regelt verdere revalidate
    res.setHeader('Cache-Control', `public, s-maxage=${TTL_S}, stale-while-revalidate=60`)
    res.status(200).json(snapshot)
  } catch (e:any) {
    res.status(500).json({ error: String(e?.message || e) })
  }
}