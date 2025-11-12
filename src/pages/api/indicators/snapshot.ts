// src/pages/api/home/snapshot.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export const config = { runtime: 'nodejs' }

type Advice = 'BUY' | 'HOLD' | 'SELL'
type NewsIn = { title: string; link: string; source?: string; pubDate?: string }
type NewsOut = { title: string; url: string; source?: string; published?: string; image?: string | null }

// ---- SnapItem is superset zodat equities-snapshot én home beide werken ----
type SnapItem = {
  symbol: string
  // equities velden:
  price?: number | null
  change?: number | null
  changePct?: number | null
  ret7Pct?: number | null
  ret30Pct?: number | null
  ma?:    { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?:   number | null
  macd?:  { macd: number | null; signal: number | null; hist: number | null }
  volume?:{ volume: number | null; avg20d: number | null; ratio: number | null }
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
  const envBase = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '')
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

/** ---------- Handler met equities fast-path ---------- */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HomeSnapshot | { error: string } | { items: SnapItem[] }>
) {
  try {
    // EQUITIES FAST-PATH: als ?symbols= is meegegeven, geef lijst van aandelen terug
    const symbolsRaw = String(req.query.symbols || '').trim()
    if (symbolsRaw) {
      res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60')
      const base = baseUrl(req)
      const symbols = symbolsRaw.split(',').map(s => s.trim()).filter(Boolean)

      // 1) Quotes (prijs + 24h change/pct)
      const quotesUrl = `${base}/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`
      const quotesResp = await fetch(quotesUrl, { cache: 'no-store', headers: { accept: 'application/json' } })
      if (!quotesResp.ok) return res.status(502).json({ error: `quotes HTTP ${quotesResp.status}` })
      const quotes = await quotesResp.json() as {
        quotes: Record<string, {
          symbol: string
          regularMarketPrice: number | null
          regularMarketChange: number | null
          regularMarketChangePercent: number | null
          currency?: string
        }>
      }

      // 2) Scores (batch indien beschikbaar; anders fallback per symbool)
      let scoreMap = new Map<string, number | null>()
      try {
        const scoreUrl = `${base}/api/indicators/score-batch?symbols=${encodeURIComponent(symbols.join(','))}`
        const scoreResp = await fetch(scoreUrl, { cache: 'no-store', headers: { accept: 'application/json' } })
        if (!scoreResp.ok) throw new Error(`score-batch HTTP ${scoreResp.status}`)
        const scoreRows = await scoreResp.json() as { items: { symbol: string; score: number | null }[] }
        scoreMap = new Map(scoreRows.items.map(r => [r.symbol, Number.isFinite(r.score as number) ? Math.round(Number(r.score)) : null]))
      } catch {
        // fallback pool (max 6 tegelijk)
        const poolSize = 6
        let i = 0
        await Promise.all(new Array(poolSize).fill(0).map(async () => {
          while (i < symbols.length) {
            const idx = i++
            const s = symbols[idx]
            try {
              const r = await fetch(`${base}/api/indicators/score/${encodeURIComponent(s)}`, { cache: 'no-store', headers: { accept: 'application/json' } })
              if (!r.ok) throw new Error()
              const j = await r.json() as { symbol: string; score: number | null }
              scoreMap.set(s, Number.isFinite(j?.score as number) ? Math.round(Number(j.score)) : null)
            } catch {
              scoreMap.set(s, null)
            }
          }
        }))
      }

      // 3) Returns 7d & 30d (soft-fail)
      let ret7Map = new Map<string, number | null>(), ret30Map = new Map<string, number | null>()
      try {
        const [ret7Resp, ret30Resp] = await Promise.all([
          fetch(`${base}/api/indicators/ret-batch?days=7&symbols=${encodeURIComponent(symbols.join(','))}`,  { cache:'no-store', headers:{accept:'application/json'} }),
          fetch(`${base}/api/indicators/ret-batch?days=30&symbols=${encodeURIComponent(symbols.join(','))}`, { cache:'no-store', headers:{accept:'application/json'} }),
        ])
        if (ret7Resp.ok) {
          const ret7 = await ret7Resp.json() as { items: { symbol:string; days:number; pct:number|null }[] }
          ret7Map = new Map(ret7.items.map(r => [r.symbol, r.pct ?? null]))
        }
        if (ret30Resp.ok) {
          const ret30 = await ret30Resp.json() as { items: { symbol:string; days:number; pct:number|null }[] }
          ret30Map = new Map(ret30.items.map(r => [r.symbol, r.pct ?? null]))
        }
      } catch { /* laat leeg */ }

      // 4) Bouw items voor equities-snapshot
      const items: SnapItem[] = symbols.map(sym => {
        const q = quotes.quotes[sym]
        const price = q?.regularMarketPrice ?? null
        const change = q?.regularMarketChange ?? null
        const changePct = q?.regularMarketChangePercent ?? null
        const score = scoreMap.get(sym) ?? null
        const ret7Pct = ret7Map.get(sym) ?? null
        const ret30Pct = ret30Map.get(sym) ?? null
        return { symbol: sym, price, change, changePct, score, ret7Pct, ret30Pct }
      })

      return res.status(200).json({ items })
    }

    // ---- HOME SNAPSHOT (ongewijzigde logica) ----
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