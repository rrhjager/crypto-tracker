// src/pages/api/home/snapshot.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { computeScoreStatus } from '@/lib/taScore'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'

// Let op: pas deze imports aan naar jouw eigen exports/locaties als dat anders is
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
export const config = { runtime: 'edge' } // edge = sneller cold start

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

const TTL_SEC = 300 // KV TTL
const localeQS = 'hl=en-US&gl=US&ceid=US:en'
const BASE = process.env.NEXT_PUBLIC_BASE_URL || 'https://signalhub.tech'

// === helpers ===
function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return null
    return await r.json() as T
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

// Klein in-memory cache op de edge-runtime (per region/process)
let CACHE: { ts: number; data: Snapshot } | null = null
const MEM_TTL_MS = 60 * 1000 // 1 minuut, om latency nog verder te drukken

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // 1) Edge in-memory cache eerst
    if (CACHE && (Date.now() - CACHE.ts) < MEM_TTL_MS) {
      res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(CACHE.data)
    }

    // 2) KV cache
    const kvKey = 'home:snapshot:v1'
    const cached = await kvGetJSON<Snapshot>(kvKey)
    if (cached) {
      CACHE = { ts: Date.now(), data: cached }
      res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120')
      return res.status(200).json(cached)
    }

    // 3) Verse build
    const v = Math.floor(Date.now() / 60_000)

    // News
    const [newsCryptoResp, newsEqResp] = await Promise.all([
      fetchJSON<any>(`${BASE}/api/news/google?q=${encodeURIComponent('crypto OR bitcoin OR ethereum OR blockchain')}&${localeQS}&v=${v}`),
      fetchJSON<any>(`${BASE}/api/news/google?q=${encodeURIComponent('equities OR stocks OR stock market OR aandelen OR beurs')}&${localeQS}&v=${v}`)
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

    // Academy
    const academyResp = await fetchJSON<any>(`${BASE}/api/academy/list?v=${v}`)
    const academy: { title: string; href: string }[] = academyResp?.items?.slice(0, 8) || []

    // Congress (laatste bovenaan sorteren gebeurt al op de homepage; hier gewoon doorgeven)
    const congressResp = await fetchJSON<any>(`${BASE}/api/market/congress?limit=30&v=${v}`)
    const congress = congressResp?.items || []

    // Equities top buy/sell per markt
    const MARKETS: MarketLabel[] = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex']

    const topBuy: (ScoredEq & { signal: Advice })[] = []
    const topSell: (ScoredEq & { signal: Advice })[] = []

    for (const label of MARKETS) {
      const list = marketList(label)
      if (!Array.isArray(list) || list.length === 0) continue
      // Gebruik snapshot-list endpoint dat zelf KV gebruikt (zuinig)
      const symbols = list.map((x: any) => x.symbol).slice(0, 60)
      const snapList = await fetchJSON<any>(`${BASE}/api/indicators/snapshot-list?symbols=${encodeURIComponent(symbols.join(','))}`)

      const rows: (ScoredEq & { signal: Advice })[] =
        (snapList?.results || []).map((row: any) => {
          const found = list.find((x: any) => x.symbol === row.symbol)
          const { score } = computeScoreStatus(row)
          const s = typeof score === 'number' ? Math.round(score) : 50
          return {
            symbol: row.symbol,
            name: found?.name || row.symbol,
            market: label,
            score: s,
            signal: statusFromScore(s)
          }
        }).filter((r: any) => Number.isFinite(r.score))

      if (rows.length) {
        const best = [...rows].sort((a, b) => b.score - a.score)[0]
        const worst = [...rows].sort((a, b) => a.score - b.score)[0]
        if (best) topBuy.push(best)
        if (worst) topSell.push(worst)
      }
    }

    // Crypto universe (zelfde set als op de homepage)
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

    const pairs = COINS.map(c => ({ c, pair: c.symbol.replace('-USD', '') + 'USDT' }))
    const cryptoResp = await fetchJSON<any>(`${BASE}/api/crypto-light/indicators?symbols=${encodeURIComponent(pairs.map(p => p.pair).join(','))}`)
    const cryptoRows: { symbol: string; name: string; score: number }[] =
      (cryptoResp?.results || []).map((row: any) => {
        const found = pairs.find(p => p.pair === row.symbol)
        const { score } = computeScoreStatus(row)
        return {
          symbol: found?.c.symbol || row.symbol,
          name: found?.c.name || row.symbol,
          score: typeof score === 'number' ? Math.round(score) : 50,
        }
      })

    const coinTopBuy: (ScoredCoin & { signal: Advice })[] =
      [...cryptoRows].sort((a, b) => b.score - a.score).slice(0, 5)
        .map(r => ({ ...r, signal: statusFromScore(r.score) }))

    const coinTopSell: (ScoredCoin & { signal: Advice })[] =
      [...cryptoRows].sort((a, b) => a.score - b.score).slice(0, 5)
        .map(r => ({ ...r, signal: statusFromScore(r.score) }))

    const data: Snapshot = {
      newsCrypto,
      newsEq,
      academy,
      congress,
      topBuy,
      topSell,
      coinTopBuy,
      coinTopSell,
    }

    // 4) Set KV + korte edge-mem cache
    await kvSetJSON(kvKey, data, TTL_SEC)
    CACHE = { ts: Date.now(), data }

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120')
    return res.status(200).json(data)
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message || err) })
  }
}