export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { cache5min } from '@/lib/cacheHeaders'
import { getOrRefreshSnap, snapKey } from '@/lib/kvSnap'
import { COINS } from '@/lib/coins'
import { AEX } from '@/lib/aex'
import { DAX } from '@/lib/dax'
import { DOWJONES } from '@/lib/dowjones'
import { ETFS } from '@/lib/etfs'
import { FTSE100 } from '@/lib/ftse100'
import { HANGSENG } from '@/lib/hangseng'
import { NASDAQ } from '@/lib/nasdaq'
import { NIKKEI225 } from '@/lib/nikkei225'
import { SENSEX } from '@/lib/sensex'
import { SP500 } from '@/lib/sp500'
import { fetchMarketDataFor, computeIndicators as computeCryptoIndicators } from '@/lib/pastPerformance/cryptoIndicatorsExact'
import { fetchMarketDataForEquity, computeIndicators as computeEquityIndicators } from '@/lib/pastPerformance/equityIndicatorsExact'
import { findQualifiedLivePicks, runAssetAudit, summarizeMarketAudit } from '@/lib/backtestAudit'
import type { ScoreMarket } from '@/lib/taScore'

type MarketKey =
  | 'crypto'
  | 'aex'
  | 'dax'
  | 'dowjones'
  | 'etfs'
  | 'ftse100'
  | 'hangseng'
  | 'nasdaq'
  | 'nikkei225'
  | 'sensex'
  | 'sp500'

type AssetSpec = {
  symbol: string
  name: string
  quoteSymbol: string
}

type MarketSpec = {
  key: MarketKey
  label: string
  scoreMarket: ScoreMarket
  kind: 'crypto' | 'equity'
  batchSize: number
  pauseMs: number
  assets: AssetSpec[]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function parseMarket(raw: string | string[] | undefined): MarketKey {
  const value = String(Array.isArray(raw) ? raw[0] : raw || 'crypto').trim().toLowerCase()
  if (value in MARKET_SPECS) return value as MarketKey
  return 'crypto'
}

function toAexSymbol(raw: string) {
  const s = String(raw || '').trim().toUpperCase()
  if (!s) return ''
  if (s.includes('.')) return s
  return `${s}.AS`
}

function toDaxSymbol(raw: string) {
  const s = String(raw || '').trim().toUpperCase()
  if (!s) return ''
  if (s.includes('.')) return s
  return `${s}.DE`
}

const MARKET_SPECS: Record<MarketKey, MarketSpec> = {
  crypto: {
    key: 'crypto',
    label: 'Crypto',
    scoreMarket: 'CRYPTO',
    kind: 'crypto',
    batchSize: 2,
    pauseMs: 650,
    assets: COINS.map((coin) => ({
      symbol: coin.symbol,
      name: coin.name,
      quoteSymbol: coin.pairUSD?.binance || `${coin.symbol}USDT`,
    })).filter((item) => !!item.quoteSymbol),
  },
  aex: {
    key: 'aex',
    label: 'AEX',
    scoreMarket: 'AEX',
    kind: 'equity',
    batchSize: 6,
    pauseMs: 300,
    assets: AEX.map((item) => ({ symbol: item.symbol, name: item.name, quoteSymbol: toAexSymbol(item.symbol) })),
  },
  dax: {
    key: 'dax',
    label: 'DAX',
    scoreMarket: 'DAX',
    kind: 'equity',
    batchSize: 6,
    pauseMs: 300,
    assets: DAX.map((item) => ({ symbol: item.symbol, name: item.name, quoteSymbol: toDaxSymbol(item.symbol) })),
  },
  dowjones: {
    key: 'dowjones',
    label: 'Dow Jones',
    scoreMarket: 'DOWJONES',
    kind: 'equity',
    batchSize: 6,
    pauseMs: 300,
    assets: DOWJONES.map((item) => ({ symbol: item.symbol, name: item.name, quoteSymbol: item.symbol })),
  },
  etfs: {
    key: 'etfs',
    label: 'ETFs',
    scoreMarket: 'ETFS',
    kind: 'equity',
    batchSize: 6,
    pauseMs: 300,
    assets: ETFS.map((item) => ({ symbol: item.symbol, name: item.name, quoteSymbol: item.symbol })),
  },
  ftse100: {
    key: 'ftse100',
    label: 'FTSE 100',
    scoreMarket: 'FTSE100',
    kind: 'equity',
    batchSize: 6,
    pauseMs: 300,
    assets: FTSE100.map((item) => ({ symbol: item.symbol, name: item.name, quoteSymbol: item.symbol })),
  },
  hangseng: {
    key: 'hangseng',
    label: 'Hang Seng',
    scoreMarket: 'HANGSENG',
    kind: 'equity',
    batchSize: 6,
    pauseMs: 300,
    assets: HANGSENG.map((item) => ({ symbol: item.symbol, name: item.name, quoteSymbol: item.symbol })),
  },
  nasdaq: {
    key: 'nasdaq',
    label: 'NASDAQ',
    scoreMarket: 'NASDAQ',
    kind: 'equity',
    batchSize: 6,
    pauseMs: 300,
    assets: NASDAQ.map((item) => ({ symbol: item.symbol, name: item.name, quoteSymbol: item.symbol })),
  },
  nikkei225: {
    key: 'nikkei225',
    label: 'Nikkei 225',
    scoreMarket: 'NIKKEI225',
    kind: 'equity',
    batchSize: 6,
    pauseMs: 300,
    assets: NIKKEI225.map((item) => ({ symbol: item.symbol, name: item.name, quoteSymbol: item.symbol })),
  },
  sensex: {
    key: 'sensex',
    label: 'Sensex',
    scoreMarket: 'SENSEX',
    kind: 'equity',
    batchSize: 6,
    pauseMs: 300,
    assets: SENSEX.map((item) => ({ symbol: item.symbol, name: item.name, quoteSymbol: item.symbol })),
  },
  sp500: {
    key: 'sp500',
    label: 'S&P 500',
    scoreMarket: 'SP500',
    kind: 'equity',
    batchSize: 6,
    pauseMs: 300,
    assets: SP500.map((item) => ({ symbol: item.symbol, name: item.name, quoteSymbol: item.symbol })),
  },
}

async function fetchAsset(spec: MarketSpec, asset: AssetSpec) {
  if (spec.kind === 'crypto') {
    const got = await fetchMarketDataFor(asset.quoteSymbol, { limit: 900 })
    if (got.ok === false) return { ok: false as const, error: got.error }
    return { ok: true as const, data: got.data }
  }

  const got = await fetchMarketDataForEquity(asset.quoteSymbol, { range: '2y', interval: '1d' })
  if (got.ok === false) return { ok: false as const, error: got.error }
  return { ok: true as const, data: got.data }
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const market = parseMarket(req.query.market)
  const spec = MARKET_SPECS[market]

  try {
    cache5min(res, 300, 1800)

    const kvKey = snapKey.custom(`backtest:market-audit:v2:${market}`)

    const compute = async () => {
      const batches = chunk(spec.assets, spec.batchSize)
      const states = []
      const errors: Array<{ symbol: string; error: string }> = []

      for (let bi = 0; bi < batches.length; bi++) {
        const group = batches[bi]
        const results = await Promise.all(
          group.map(async (asset) => {
            const got = await fetchAsset(spec, asset)
            if (!got.ok) {
              return { ok: false as const, symbol: asset.symbol, error: got.error }
            }

            const n = Math.min(got.data.times.length, got.data.closes.length, got.data.volumes.length)
            if (n < 202) {
              return { ok: false as const, symbol: asset.symbol, error: 'Not enough history' }
            }

            const state = runAssetAudit(
              {
                symbol: asset.symbol,
                name: asset.name,
                market: spec.scoreMarket,
                times: got.data.times,
                closes: got.data.closes,
                volumes: got.data.volumes,
              },
              spec.kind === 'crypto' ? computeCryptoIndicators : computeEquityIndicators
            )

            return { ok: true as const, state }
          })
        )

        for (const result of results) {
          if (!result.ok) {
            errors.push({ symbol: result.symbol, error: result.error })
            continue
          }
          states.push(result.state)
        }

        if (bi < batches.length - 1) await sleep(spec.pauseMs)
      }

      return {
        meta: {
          market: spec.key,
          label: spec.label,
          scoreMarket: spec.scoreMarket,
          computedAt: Date.now(),
          lookback: spec.kind === 'crypto' ? '900 daily candles' : '2 years daily candles',
          window: '200 daily candles rolling',
          universeSize: spec.assets.length,
          processedAssets: states.length,
          skippedAssets: errors.length,
          note:
            'Dit is een voorspellende event-backtest op de echte score-engine. De live premium rankingfilter wordt hier bewust niet gebruikt als bewijs, omdat die forward-looking velden bevat.',
        },
        strategies: summarizeMarketAudit(states),
        qualifiedLivePicks: findQualifiedLivePicks(states),
        sampleErrors: errors.slice(0, 10),
      }
    }

    const { data, stale } = await getOrRefreshSnap(kvKey, compute, {
      freshMs: 30 * 60_000,
      staleMs: 12 * 60 * 60_000,
      ttlMs: 24 * 60 * 60_000,
    })

    return res.status(200).json({
      ...data,
      meta: {
        ...data.meta,
        stale,
      },
    })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error', market })
  }
}
