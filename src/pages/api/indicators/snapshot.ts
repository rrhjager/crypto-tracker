// src/pages/api/home/snapshot.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export const config = { runtime: 'nodejs' }

type Advice = 'BUY' | 'HOLD' | 'SELL'
type NewsIn = { title: string; link: string; source?: string; pubDate?: string }
type NewsOut = { title: string; url: string; source?: string; published?: string; image?: string | null }

type SnapItem = {
  symbol: string
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
  // equities topBuy/topSell laten we leeg; homepage rekent die exact client-side per markt
  topBuy: any[];
  topSell: any[];
  coinTopBuy: ScoredCoin[];
  coinTopSell: ScoredCoin[];
  academy: { title: string; href: string }[];
  congress: CongressTrade[];
}

const TTL_S = 300
const CRYPTO_BATCH = 25

// Yahoo-crypto universum (zelfde als op de homepage)
const COINS: { symbol: string; name: string }[] = [
  { symbol: 'BTC-USD',  name: 'Bitcoin' },
  { symbol: 'ETH-USD',  name: 'Ethereum' },
  { symbol: 'BNB-USD',  name: 'BNB' },
  { symbol: 'SOL-USD',  name: 'Solana' },
  { symbol: 'XRP-USD',  name: 'XRP' },
  { symbol: 'ADA-USD',  name: 'Cardano' },
  { symbol: 'DOGE-USD', name: 'Dogecoin' },
  { symbol: 'TON-USD',  name: 'Toncoin' },
  { symbol: 'TRX-USD',  name: 'TRON' },
  { symbol: 'AVAX-USD', name: 'Avalanche' },
  { symbol: 'DOT-USD',  name: 'Polkadot' },
  { symbol: 'LINK-USD', name: 'Chainlink' },
  { symbol: 'BCH-USD',  name: 'Bitcoin Cash' },
  { symbol: 'LTC-USD',  name: 'Litecoin' },
  { symbol: 'MATIC-USD', name: 'Polygon' },
  { symbol: 'XLM-USD',  name: 'Stellar' },
  { symbol: 'NEAR-USD', name: 'NEAR' },
  { symbol: 'ICP-USD',  name: 'Internet Computer' },
  { symbol: 'ETC-USD',  name: 'Ethereum Classic' },
  { symbol: 'FIL-USD',  name: 'Filecoin' },
  { symbol: 'XMR-USD',  name: 'Monero' },
  { symbol: 'APT-USD',  name: 'Aptos' },
  { symbol: 'ARB-USD',  name: 'Arbitrum' },
  { symbol: 'OP-USD',   name: 'Optimism' },
  { symbol: 'SUI-USD',  name: 'Sui' },
  { symbol: 'HBAR-USD', name: 'Hedera' },
  { symbol: 'ALGO-USD', name: 'Algorand' },
  { symbol: 'VET-USD',  name: 'VeChain' },
  { symbol: 'EGLD-USD', name: 'MultiversX' },
  { symbol: 'AAVE-USD', name: 'Aave' },
  { symbol: 'INJ-USD',  name: 'Injective' },
  { symbol: 'MKR-USD',  name: 'Maker' },
  { symbol: 'RUNE-USD', name: 'THORChain' },
  { symbol: 'IMX-USD',  name: 'Immutable' },
  { symbol: 'FLOW-USD', name: 'Flow' },
  { symbol: 'SAND-USD', name: 'The Sandbox' },
  { symbol: 'MANA-USD', name: 'Decentraland' },
  { symbol: 'AXS-USD',  name: 'Axie Infinity' },
  { symbol: 'QNT-USD',  name: 'Quant' },
  { symbol: 'GRT-USD',  name: 'The Graph' },
  { symbol: 'CHZ-USD',  name: 'Chiliz' },
  { symbol: 'CRV-USD',  name: 'Curve DAO' },
  { symbol: 'ENJ-USD',  name: 'Enjin Coin' },
  { symbol: 'FTM-USD',  name: 'Fantom' },
  { symbol: 'XTZ-USD',  name: 'Tezos' },
  { symbol: 'LDO-USD',  name: 'Lido DAO' },
  { symbol: 'SNX-USD',  name: 'Synthetix' },
  { symbol: 'STX-USD',  name: 'Stacks' },
  { symbol: 'AR-USD',   name: 'Arweave' },
  { symbol: 'GMX-USD',  name: 'GMX' },
]

// Small helpers
const statusFromScore = (score: number): Advice => (score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD')

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

function baseUrl(req: NextApiRequest) {
  const envBase = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '')
  if (envBase) return envBase
  const proto = (req.headers['x-forwarded-proto'] as string) || 'http'
  const host = req.headers.host
  return `${proto}://${host}`
}

/** News via eigen Google endpoint */
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

/** Server-side CRYPTO toplists via jouw eigen /api/indicators/snapshot (Yahoo symbols) */
async function computeCryptoServerSide(req: NextApiRequest) {
  const symbols = COINS.map(c => c.symbol)
  const batches: string[][] = []
  for (let i = 0; i < symbols.length; i += CRYPTO_BATCH) batches.push(symbols.slice(i, i + CRYPTO_BATCH))

  async function fetchBatch(chunk: string[]): Promise<IndicatorsSnapshotResp> {
    const url = `${baseUrl(req)}/api/indicators/snapshot?symbols=${encodeURIComponent(chunk.join(','))}`
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return { items: [] }
    return (await r.json()) as IndicatorsSnapshotResp
  }

  // parallel in beperkte pool
  const results = await pool(batches, 3, fetchBatch)
  const mapScore = new Map<string, number>()
  for (const res of results) {
    for (const it of (res.items || [])) {
      if (Number.isFinite(it?.score as number)) {
        mapScore.set(it.symbol, Math.round(Number(it.score)))
      }
    }
  }

  const rows = COINS
    .map(c => {
      const s = mapScore.get(c.symbol)
      return Number.isFinite(s) ? { symbol: c.symbol, name: c.name, score: s as number } : null
    })
    .filter(Boolean) as { symbol: string; name: string; score: number }[]

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
      coinTopBuy: crypto.coinTopBuy,
      coinTopSell: crypto.coinTopSell,
      academy,
      congress,
    }

    // korte CDN-cache; ISR van index.tsx bepaalt revalidate verder
    res.setHeader('Cache-Control', `public, s-maxage=${TTL_S}, stale-while-revalidate=60`)
    res.status(200).json(snapshot)
  } catch (e:any) {
    res.status(500).json({ error: String(e?.message || e) })
  }
}