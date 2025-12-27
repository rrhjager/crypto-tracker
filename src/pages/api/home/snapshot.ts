// src/pages/api/home/snapshot.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { computeScoreStatus } from '@/lib/taScore'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'

import { AEX } from '@/lib/aex'
import { SP500 } from '@/lib/sp500'
import { NASDAQ } from '@/lib/nasdaq'
import { DOWJONES } from '@/lib/dowjones'
import { DAX as DAX_FULL } from '@/lib/dax'
import { FTSE100 } from '@/lib/ftse100'
import { NIKKEI225 } from '@/lib/nikkei225'
import { HANGSENG } from '@/lib/hangseng'
import { SENSEX } from '@/lib/sensex'

type Advice = 'BUY' | 'SELL' | 'HOLD'
type NewsItem = { title: string; url: string; source?: string; published?: string; image?: string | null }
type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'

type ScoredEq   = { symbol: string; name: string; market: MarketLabel; score: number }
type ScoredCoin = { symbol: string; name: string; score: number }

type Snapshot = {
  newsCrypto: NewsItem[]
  newsEq: NewsItem[]
  academy: { title: string; href: string }[]
  congress: any[]
  topBuy: (ScoredEq & { signal: Advice })[]
  topSell: (ScoredEq & { signal: Advice })[]
  coinTopBuy: (ScoredCoin & { signal: Advice })[]
  coinTopSell: (ScoredCoin & { signal: Advice })[]
}

type KVPayload = { updatedAt: number; value: Snapshot }

// “Up-to-date” window voor homepage
const FRESH_MS = 5 * 60_000

// KV mag lang blijven leven zodat je bijna nooit een miss hebt
const KV_TTL_SEC = 24 * 60 * 60 // 24 uur

// In-memory cache per lambda/process (extra snel)
const MEM_TTL_MS = 60_000 // 1 minuut

const localeQS = 'hl=en-US&gl=US&ceid=US:en'
const BASE_ENV = process.env.NEXT_PUBLIC_BASE_URL || ''

function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

function marketList(label: MarketLabel) {
  if (label === 'AEX') return AEX
  if (label === 'S&P 500') return SP500
  if (label === 'NASDAQ') return NASDAQ
  if (label === 'Dow Jones') return DOWJONES
  if (label === 'DAX') return DAX_FULL
  if (label === 'FTSE 100') return FTSE100
  if (label === 'Nikkei 225') return NIKKEI225
  if (label === 'Hang Seng') return HANGSENG
  if (label === 'Sensex') return SENSEX
  return []
}

function getOrigin(req: NextApiRequest) {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000'
  return `${proto}://${host}`
}

async function pool<T, R>(arr: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length) as any
  let i = 0
  await Promise.all(
    new Array(Math.min(n, arr.length)).fill(0).map(async () => {
      while (true) {
        const idx = i++
        if (idx >= arr.length) break
        out[idx] = await fn(arr[idx], idx)
      }
    }),
  )
  return out
}

// Klein in-memory cache per lambda/process
let CACHE: { ts: number; payload: KVPayload } | null = null

// Anti-stampede voor background refresh (en voor cold start)
let INFLIGHT_REFRESH: Promise<KVPayload> | null = null

async function buildSnapshot(origin: string): Promise<Snapshot> {
  const v = Math.floor(Date.now() / 60_000)

  const [newsCryptoResp, newsEqResp, academyResp, congressResp] = await Promise.all([
    fetchJSON<any>(`${origin}/api/news/google?q=${encodeURIComponent('crypto OR bitcoin OR ethereum OR blockchain')}&${localeQS}&v=${v}`),
    fetchJSON<any>(`${origin}/api/news/google?q=${encodeURIComponent('equities OR stocks OR stock market OR aandelen OR beurs')}&${localeQS}&v=${v}`),
    fetchJSON<any>(`${origin}/api/academy/list?v=${v}`),
    fetchJSON<any>(`${origin}/api/market/congress?limit=30&v=${v}`),
  ])

  const newsCrypto: NewsItem[] = (newsCryptoResp?.items || []).slice(0, 6).map((x: any) => ({
    title: x.title || '',
    url: x.link,
    source: x.source || '',
    published: x.pubDate || '',
    image: null,
  }))
  const newsEq: NewsItem[] = (newsEqResp?.items || []).slice(0, 6).map((x: any) => ({
    title: x.title || '',
    url: x.link,
    source: x.source || '',
    published: x.pubDate || '',
    image: null,
  }))

  const academy: { title: string; href: string }[] =
    Array.isArray(academyResp?.items) ? academyResp.items.slice(0, 8) : []

  const congressRaw: any[] = Array.isArray(congressResp?.items) ? congressResp.items : []
  const congress = congressRaw
    .map(x => {
      const dateISO =
        (typeof x.publishedISO === 'string' && x.publishedISO) ||
        (typeof x.tradedISO === 'string' && x.tradedISO) ||
        (typeof x.published === 'string' && x.published) ||
        (typeof x.traded === 'string' && x.traded) ||
        ''
      return {
        person: x.person || '',
        ticker: (x.ticker || '').toUpperCase(),
        side: String(x.side || '—').toUpperCase(),
        amount: x.amount || '',
        price: x.price ?? null,
        date: dateISO,
        url: x.url || '',
      }
    })
    .filter(t => t.date && !Number.isNaN(Date.parse(t.date)))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 30)

  const MARKETS: MarketLabel[] = [
    'AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex',
  ]

  // Paralleliseer markets: sneller bij rebuild, output identiek
  const perMarket = await pool(MARKETS, 3, async (label) => {
    const list = marketList(label)
    if (!Array.isArray(list) || list.length === 0) return { label, best: null as any, worst: null as any }

    const symbols = list.map((x: any) => x.symbol).slice(0, 60)
    if (!symbols.length) return { label, best: null, worst: null }

    const snapResp = await fetchJSON<{ items?: { symbol: string; score?: number | null }[] }>(
      `${origin}/api/indicators/snapshot?symbols=${encodeURIComponent(symbols.join(','))}`,
    )

    const rawRows = (snapResp?.items || []) as { symbol: string; score?: number | null }[]
    const rows = rawRows
      .map(row => {
        const found = list.find((x: any) => x.symbol === row.symbol)
        const scoreRaw = row.score
        if (typeof scoreRaw !== 'number' || !Number.isFinite(scoreRaw)) return null
        const s = Math.round(scoreRaw)
        return {
          symbol: row.symbol,
          name: found?.name || row.symbol,
          market: label,
          score: s,
          signal: statusFromScore(s),
        }
      })
      .filter(Boolean) as any[]

    if (!rows.length) return { label, best: null, worst: null }
    const best = [...rows].sort((a, b) => b.score - a.score)[0]
    const worst = [...rows].sort((a, b) => a.score - b.score)[0]
    return { label, best, worst }
  })

  const topBuy: any[] = []
  const topSell: any[] = []
  for (const m of MARKETS) {
    const r = perMarket.find(x => x.label === m)
    if (r?.best) topBuy.push(r.best)
    if (r?.worst) topSell.push(r.worst)
  }

  // Crypto (zelfde als huidige)
  const COINS: { symbol: string; name: string }[] = [
    { symbol: 'BTC-USD', name: 'Bitcoin' },
    { symbol: 'ETH-USD', name: 'Ethereum' },
    { symbol: 'BNB-USD', name: 'BNB' },
    { symbol: 'SOL-USD', name: 'Solana' },
    { symbol: 'XRP-USD', name: 'XRP' },
    { symbol: 'ADA-USD', name: 'Cardano' },
    { symbol: 'DOGE-USD', name: 'Dogecoin' },
    { symbol: 'TON-USD', name: 'Toncoin' },
    { symbol: 'TRX-USD', name: 'TRON' },
    { symbol: 'AVAX-USD', name: 'Avalanche' },
    { symbol: 'DOT-USD', name: 'Polkadot' },
    { symbol: 'LINK-USD', name: 'Chainlink' },
    { symbol: 'BCH-USD', name: 'Bitcoin Cash' },
    { symbol: 'LTC-USD', name: 'Litecoin' },
    { symbol: 'MATIC-USD', name: 'Polygon' },
    { symbol: 'XLM-USD', name: 'Stellar' },
    { symbol: 'NEAR-USD', name: 'NEAR' },
    { symbol: 'ICP-USD', name: 'Internet Computer' },
    { symbol: 'ETC-USD', name: 'Ethereum Classic' },
    { symbol: 'FIL-USD', name: 'Filecoin' },
    { symbol: 'XMR-USD', name: 'Monero' },
    { symbol: 'APT-USD', name: 'Aptos' },
    { symbol: 'ARB-USD', name: 'Arbitrum' },
    { symbol: 'OP-USD', name: 'Optimism' },
    { symbol: 'SUI-USD', name: 'Sui' },
    { symbol: 'HBAR-USD', name: 'Hedera' },
    { symbol: 'ALGO-USD', name: 'Algorand' },
    { symbol: 'VET-USD', name: 'VeChain' },
    { symbol: 'EGLD-USD', name: 'MultiversX' },
    { symbol: 'AAVE-USD', name: 'Aave' },
    { symbol: 'INJ-USD', name: 'Injective' },
    { symbol: 'MKR-USD', name: 'Maker' },
    { symbol: 'RUNE-USD', name: 'THORChain' },
    { symbol: 'IMX-USD', name: 'Immutable' },
    { symbol: 'FLOW-USD', name: 'Flow' },
    { symbol: 'SAND-USD', name: 'The Sandbox' },
    { symbol: 'MANA-USD', name: 'Decentraland' },
    { symbol: 'AXS-USD', name: 'Axie Infinity' },
    { symbol: 'QNT-USD', name: 'Quant' },
    { symbol: 'GRT-USD', name: 'The Graph' },
    { symbol: 'CHZ-USD', name: 'Chiliz' },
    { symbol: 'CRV-USD', name: 'Curve DAO' },
    { symbol: 'ENJ-USD', name: 'Enjin Coin' },
    { symbol: 'FTM-USD', name: 'Fantom' },
    { symbol: 'XTZ-USD', name: 'Tezos' },
    { symbol: 'LDO-USD', name: 'Lido DAO' },
    { symbol: 'SNX-USD', name: 'Synthetix' },
    { symbol: 'STX-USD', name: 'Stacks' },
    { symbol: 'AR-USD', name: 'Arweave' },
    { symbol: 'GMX-USD', name: 'GMX' },
  ]
  const pairs = COINS.map(c => ({ c, pair: c.symbol.replace('-USD', '') + 'USDT' }))

  const cryptoResp = await fetchJSON<any>(
    `${origin}/api/crypto-light/indicators?symbols=${encodeURIComponent(pairs.map(p => p.pair).join(','))}`,
  )

  const cryptoRows: { symbol: string; name: string; score: number }[] = (cryptoResp?.results || [])
    .map((row: any) => {
      const found = pairs.find(p => p.pair === row.symbol)
      const { score } = computeScoreStatus(row as any)
      if (typeof score !== 'number' || !Number.isFinite(score)) return null
      return {
        symbol: found?.c.symbol || row.symbol,
        name: found?.c.name || row.symbol,
        score: Math.round(score),
      }
    })
    .filter(Boolean) as any[]

  const coinTopBuy: any[] = [...cryptoRows]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(r => ({ ...r, signal: statusFromScore(r.score) }))

  const coinTopSell: any[] = [...cryptoRows]
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map(r => ({ ...r, signal: statusFromScore(r.score) }))

  return { newsCrypto, newsEq, academy, congress, topBuy, topSell, coinTopBuy, coinTopSell }
}

function isAuthorized(req: NextApiRequest) {
  if (!process.env.WARMUP_TOKEN) return true
  const token = (req.query.token as string) || (req.headers['x-warmup-token'] as string)
  return token === process.env.WARMUP_TOKEN
}

function setHeaders(res: NextApiResponse, payload?: KVPayload, source?: string) {
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  if (payload?.updatedAt) {
    const age = Date.now() - payload.updatedAt
    res.setHeader('x-home-snapshot-age-ms', String(age))
    res.setHeader('x-home-snapshot-stale', age > FRESH_MS ? '1' : '0')
  }
  if (source) res.setHeader('x-home-snapshot-source', source) // mem|kv|build|refresh
}

function maybeBackgroundRefresh(origin: string, kvKey: string, current?: KVPayload) {
  const age = current?.updatedAt ? (Date.now() - current.updatedAt) : Infinity
  const stale = age > FRESH_MS

  if (!stale) return
  if (INFLIGHT_REFRESH) return

  INFLIGHT_REFRESH = (async () => {
    const value = await buildSnapshot(origin)
    const payload: KVPayload = { updatedAt: Date.now(), value }
    await kvSetJSON(kvKey, payload, KV_TTL_SEC)
    CACHE = { ts: Date.now(), payload }
    return payload
  })().finally(() => {
    INFLIGHT_REFRESH = null
  }) as any
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Snapshot | { error: string }>
) {
  try {
    const origin = BASE_ENV || getOrigin(req)
    const kvKey = 'home:snapshot:v3'

    const refresh = String(req.query.refresh || '0') === '1'

    // 1) Handmatige refresh (alleen cron/internal)
    if (refresh) {
      if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })
      const value = await buildSnapshot(origin)
      const payload: KVPayload = { updatedAt: Date.now(), value }
      await kvSetJSON(kvKey, payload, KV_TTL_SEC)
      CACHE = { ts: Date.now(), payload }
      setHeaders(res, payload, 'refresh')
      return res.status(200).json(value)
    }

    // 2) In-memory cache
    if (CACHE && Date.now() - CACHE.ts < MEM_TTL_MS) {
      // stale? → achtergrond refresh, maar altijd direct returnen
      maybeBackgroundRefresh(origin, kvKey, CACHE.payload)
      setHeaders(res, CACHE.payload, 'mem')
      return res.status(200).json(CACHE.payload.value)
    }

    // 3) KV fast-path
    const payload = await kvGetJSON<KVPayload>(kvKey)
    if (payload?.value) {
      CACHE = { ts: Date.now(), payload }
      // stale? → achtergrond refresh, maar altijd direct returnen
      maybeBackgroundRefresh(origin, kvKey, payload)
      setHeaders(res, payload, 'kv')
      return res.status(200).json(payload.value)
    }

    // 4) Eerste keer ooit (KV leeg) — éénmalig traag
    // Anti-stampede: als er al een build loopt, wacht daarop
    if (INFLIGHT_REFRESH) {
      const p = await INFLIGHT_REFRESH
      setHeaders(res, p, 'build')
      return res.status(200).json(p.value)
    }

    INFLIGHT_REFRESH = (async () => {
      const value = await buildSnapshot(origin)
      const first: KVPayload = { updatedAt: Date.now(), value }
      await kvSetJSON(kvKey, first, KV_TTL_SEC)
      CACHE = { ts: Date.now(), payload: first }
      return first
    })().finally(() => {
      INFLIGHT_REFRESH = null
    }) as any

    const built = await INFLIGHT_REFRESH
    setHeaders(res, built, 'build')
    return res.status(200).json(built.value)
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message || err) })
  }
}