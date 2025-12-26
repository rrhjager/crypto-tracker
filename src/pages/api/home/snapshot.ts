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

// === Types ===
type Advice = 'BUY' | 'SELL' | 'HOLD'
type NewsItem = { title: string; url: string; source?: string; published?: string; image?: string | null }
type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'

type ScoredEq = { symbol: string; name: string; market: MarketLabel; score: number }
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

// KV TTL lang houden; cron zorgt dat data toch ~5 min vers blijft
const TTL_SEC = 30 * 60 // 30 min
const localeQS = 'hl=en-US&gl=US&ceid=US:en'
const BASE_ENV = process.env.NEXT_PUBLIC_BASE_URL || '' // fallback naar request-origin

const kvKey = 'home:snapshot:v2'
const lockKey = 'home:snapshot:lock:v1'
const LOCK_TTL_SEC = 90

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

// ======================
// Warmup helpers (optioneel) — ongewijzigd
// ======================
type MarketKey = 'AEX' | 'SP500' | 'NASDAQ' | 'DOWJONES' | 'DAX' | 'FTSE100' | 'NIKKEI225' | 'HANGSENG' | 'SENSEX'
const MARKET_SYMBOLS: Record<MarketKey, string[]> = {
  AEX: AEX.map(x => x.symbol),
  SP500: SP500.map(x => x.symbol),
  NASDAQ: NASDAQ.map(x => x.symbol),
  DOWJONES: DOWJONES.map(x => x.symbol),
  DAX: DAX_FULL.map(x => x.symbol),
  FTSE100: FTSE100.map(x => x.symbol),
  NIKKEI225: NIKKEI225.map(x => x.symbol),
  HANGSENG: HANGSENG.map(x => x.symbol),
  SENSEX: SENSEX.map(x => x.symbol),
}

const CHUNK = 50
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
async function pool<T, R>(arr: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length) as any
  let i = 0
  await Promise.all(
    new Array(n).fill(0).map(async () => {
      while (i < arr.length) {
        const idx = i++
        out[idx] = await fn(arr[idx], idx)
      }
    }),
  )
  return out
}

function getOrigin(req: NextApiRequest) {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000'
  return `${proto}://${host}`
}

async function warmMarkets(origin: string, keys: MarketKey[]) {
  const results: Array<{ market: MarketKey; warmed: number }> = []
  for (const key of keys) {
    const symbols = MARKET_SYMBOLS[key] || []
    if (!symbols.length) {
      results.push({ market: key, warmed: 0 })
      continue
    }
    const groups = chunk(symbols, CHUNK)
    const parts = await pool(groups, 3, async (group, gi) => {
      if (gi) await sleep(80)
      const url = `${origin}/api/indicators/snapshot?symbols=${encodeURIComponent(group.join(','))}`
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(`snapshot warm ${key}[${gi}] HTTP ${r.status}`)
      const j = (await r.json()) as { items?: any[] }
      return j.items?.length || 0
    })
    results.push({ market: key, warmed: parts.reduce((a, b) => a + Number(b || 0), 0) })
  }
  return results
}

// Klein in-memory cache per lambda/process
let CACHE: { ts: number; data: Snapshot } | null = null
const MEM_TTL_MS = 60 * 1000

function emptySnapshot(): Snapshot {
  return {
    newsCrypto: [],
    newsEq: [],
    academy: [],
    congress: [],
    topBuy: [],
    topSell: [],
    coinTopBuy: [],
    coinTopSell: [],
  }
}

function requireWarmToken(req: NextApiRequest) {
  if (!process.env.WARMUP_TOKEN) return true
  const token = (req.query.token as string) || (req.headers['x-warmup-token'] as string)
  return token === process.env.WARMUP_TOKEN
}

async function buildSnapshot(origin: string): Promise<Snapshot> {
  const v = Math.floor(Date.now() / 60_000)

  // ---- News (crypto + equities) ----
  const [newsCryptoResp, newsEqResp] = await Promise.all([
    fetchJSON<any>(
      `${origin}/api/news/google?q=${encodeURIComponent('crypto OR bitcoin OR ethereum OR blockchain')}&${localeQS}&v=${v}`,
    ),
    fetchJSON<any>(
      `${origin}/api/news/google?q=${encodeURIComponent('equities OR stocks OR stock market OR aandelen OR beurs')}&${localeQS}&v=${v}`,
    ),
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

  // ---- Academy ----
  const academyResp = await fetchJSON<any>(`${origin}/api/academy/list?v=${v}`)
  const academy: { title: string; href: string }[] =
    Array.isArray(academyResp?.items) ? academyResp.items.slice(0, 8) : []

  // ---- Congress ----
  const congressResp = await fetchJSON<any>(`${origin}/api/market/congress?limit=30&v=${v}`)
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

  // ---- Equities top BUY/SELL per markt ----
  const MARKETS: MarketLabel[] = [
    'AEX',
    'S&P 500',
    'NASDAQ',
    'Dow Jones',
    'DAX',
    'FTSE 100',
    'Nikkei 225',
    'Hang Seng',
    'Sensex',
  ]

  const topBuy: (ScoredEq & { signal: Advice })[] = []
  const topSell: (ScoredEq & { signal: Advice })[] = []

  for (const label of MARKETS) {
    const list = marketList(label)
    if (!Array.isArray(list) || list.length === 0) continue

    // bounded: max 60
    const symbols = list.map((x: any) => x.symbol).slice(0, 60)
    if (!symbols.length) continue

    const snapResp = await fetchJSON<{ items?: { symbol: string; score?: number | null }[] }>(
      `${origin}/api/indicators/snapshot?symbols=${encodeURIComponent(symbols.join(','))}`,
    )

    const rawRows = (snapResp?.items || []) as { symbol: string; score?: number | null }[]

    const rows: (ScoredEq & { signal: Advice })[] = rawRows
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

    if (rows.length) {
      const best = [...rows].sort((a, b) => b.score - a.score)[0]
      const worst = [...rows].sort((a, b) => a.score - b.score)[0]
      if (best) topBuy.push(best)
      if (worst) topSell.push(worst)
    }
  }

  // ---- Crypto universe (zoals je huidige code) ----
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

  const coinTopBuy: (ScoredCoin & { signal: Advice })[] = [...cryptoRows]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(r => ({ ...r, signal: statusFromScore(r.score) }))

  const coinTopSell: (ScoredCoin & { signal: Advice })[] = [...cryptoRows]
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map(r => ({ ...r, signal: statusFromScore(r.score) }))

  return {
    newsCrypto,
    newsEq,
    academy,
    congress,
    topBuy,
    topSell,
    coinTopBuy,
    coinTopSell,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const origin = BASE_ENV || getOrigin(req)

    // --------- Warmup modus (ongewijzigd) ----------
    const warm = String(req.query.warm || '0') === '1'
    if (warm) {
      const q = String(req.query.markets || 'ALL').toUpperCase()
      const keys: MarketKey[] =
        q === 'ALL'
          ? (Object.keys(MARKET_SYMBOLS) as MarketKey[])
          : q
              .split(',')
              .map(s => s.trim())
              .filter((m): m is MarketKey => m in MARKET_SYMBOLS)

      if (!requireWarmToken(req)) return res.status(401).json({ error: 'Unauthorized' })

      const warmed = await warmMarkets(origin, keys)
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=180')
      return res.status(200).json({ warmed, when: new Date().toISOString() })
    }
    // --------- Einde warmup ----------

    // ---- Refresh modus (alleen cron) ----
    const refresh = String(req.query.refresh || '0') === '1'
    if (refresh) {
      if (!requireWarmToken(req)) return res.status(401).json({ error: 'Unauthorized' })

      // best-effort lock tegen stampede
      const lock = await kvGetJSON<{ ts: number }>(lockKey)
      if (lock?.ts && Date.now() - lock.ts < LOCK_TTL_SEC * 1000) {
        // lock actief → return huidige KV (of empty) direct
        const cached = await kvGetJSON<Snapshot>(kvKey)
        res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=60')
        return res.status(200).json(cached || emptySnapshot())
      }

      await kvSetJSON(lockKey, { ts: Date.now() }, LOCK_TTL_SEC)

      const data = await buildSnapshot(origin)
      await kvSetJSON(kvKey, data, TTL_SEC)
      CACHE = { ts: Date.now(), data }

      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
      return res.status(200).json(data)
    }

    // ---- Visitor path: altijd snel, KV-first ----

    // 1) In-memory cache
    if (CACHE && Date.now() - CACHE.ts < MEM_TTL_MS) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
      return res.status(200).json(CACHE.data)
    }

    // 2) KV cache
    const cached = await kvGetJSON<Snapshot>(kvKey)
    if (cached) {
      CACHE = { ts: Date.now(), data: cached }
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
      return res.status(200).json(cached)
    }

    // 3) Als KV leeg is:
    // - production: NIET rebuilden (blijft instant), cron moet 'm vullen
    // - dev/local: wel rebuilden zodat lokaal niets “kapot” voelt
    if (process.env.NODE_ENV !== 'production') {
      const data = await buildSnapshot(origin)
      await kvSetJSON(kvKey, data, TTL_SEC)
      CACHE = { ts: Date.now(), data }
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=180')
      return res.status(200).json(data)
    }

    // production fallback: instant lege snapshot (UI blijft werken, alleen leeg)
    res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=60')
    return res.status(200).json(emptySnapshot())
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message || err) })
  }
}