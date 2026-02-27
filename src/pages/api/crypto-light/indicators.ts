// src/pages/api/crypto-light/indicators.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'
import { cache5min } from '@/lib/cacheHeaders'

// ⬇️ KV snapshot helpers
import { getOrRefreshSnap, snapKey } from '@/lib/kvSnap'

// ✅ unified score engine (same as equities snapshot.ts)
import { computeScoreStatus } from '@/lib/taScore'

// ✅ shared TA helpers (same as equities snapshot.ts)
import { sma, rsi as rsiWilder, macd as macdCalc, avgVolume } from '@/lib/ta-light'
import { latestTrendFeatures, latestVolatilityFeatures } from '@/lib/taExtras'

// ---------- helpers (general) ----------
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

// ⬇️ detecteer “platte” reeksen en forceer fallback
function isSeriesFlat(closes: number[], { minLen = 50, eps = 1e-9, window = 30 } = {}) {
  if (!closes || closes.length < minLen) return true
  const tail = closes.slice(-window)
  const min = Math.min(...tail)
  const max = Math.max(...tail)
  if (!Number.isFinite(min) || !Number.isFinite(max)) return true
  return (max - min) <= eps
}

// ---- Binance-style symbol -> CoinGecko ID ALIASES ----
const CG_ALIASES: Record<string, string[]> = {
  BTCUSDT: ['bitcoin'],
  ETHUSDT: ['ethereum'],
  BNBUSDT: ['binancecoin'],
  SOLUSDT: ['solana'],
  XRPUSDT: ['ripple'],
  ADAUSDT: ['cardano'],
  DOGEUSDT: ['dogecoin'],
  TRXUSDT: ['tron'],
  TONUSDT: ['toncoin', 'the-open-network'],
  AVAXUSDT: ['avalanche-2'],
  MATICUSDT: ['matic-network'],
  DOTUSDT: ['polkadot'],
  LTCUSDT: ['litecoin'],
  BCHUSDT: ['bitcoin-cash'],
  LINKUSDT: ['chainlink'],
  XLMUSDT: ['stellar'],
  NEARUSDT: ['near'],
  ATOMUSDT: ['cosmos'],
  ETCUSDT: ['ethereum-classic'],
  XMRUSDT: ['monero'],
  ARBUSDT: ['arbitrum'],
  OPUSDT: ['optimism'],
  INJUSDT: ['injective-protocol'],
  APTUSDT: ['aptos'],
  SUIUSDT: ['sui'],
  SHIBUSDT: ['shiba-inu'],
  VETUSDT: ['vechain'],
  EGLDUSDT: ['multiversx'],
  IMXUSDT: ['immutable-x'],
  GRTUSDT: ['the-graph'],
  STXUSDT: ['stacks', 'blockstack'],
  RUNEUSDT: ['thorchain'],
  RNDRUSDT: ['render-token'],
  AAVEUSDT: ['aave'],
  MKRUSDT: ['maker', 'makerdao'],
  UNIUSDT: ['uniswap'],
  FLOWUSDT: ['flow'],
  CHZUSDT: ['chiliz'],
  MANAUSDT: ['decentraland'],
  SANDUSDT: ['the-sandbox'],
  AXSUSDT: ['axie-infinity'],
  DYDXUSDT: ['dydx-chain', 'dydx'],
  KASUSDT: ['kaspa'],
  SEIUSDT: ['sei-network', 'sei'],
  BONKUSDT: ['bonk'],
  JASMYUSDT: ['jasmycoin'],
  FTMUSDT: ['fantom'],
  PEPEUSDT: ['pepe'],
  ICPUSDT: ['internet-computer'],
  FILUSDT: ['filecoin'],
  ALGOUSDT: ['algorand'],
  QNTUSDT: ['quant', 'quant-network'],
  THETAUSDT: ['theta-token'],
}

// ---------- market data fetchers (OKX -> Bitfinex -> CoinGecko) ----------
type MarketData = { closes: number[]; volumes: number[] }

async function okxFetch(instId: string): Promise<MarketData | null> {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=1D&limit=200`
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) return null
  const j = await r.json()
  const arr: any[] = Array.isArray(j?.data) ? j.data : []
  if (!arr.length) return null
  const rows = arr.slice().reverse()
  const closes = rows.map(x => Number(x?.[4])).filter(Number.isFinite)
  const volumes = rows.map(x => Number(x?.[5])).filter(Number.isFinite)
  if (closes.length < 50) return null
  if (isSeriesFlat(closes)) return null
  return { closes, volumes }
}

async function bitfinexFetch(tSymbol: string): Promise<MarketData | null> {
  const url = `https://api-pub.bitfinex.com/v2/candles/trade:1D:${encodeURIComponent(tSymbol)}/hist?limit=200`
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) return null
  const arr: any[] = await r.json()
  if (!Array.isArray(arr) || !arr.length) return null
  const rows = arr.slice().reverse()
  const closes = rows.map(x => Number(x?.[2])).filter(Number.isFinite)
  const volumes = rows.map(x => Number(x?.[5])).filter(Number.isFinite)
  if (closes.length < 50) return null
  if (isSeriesFlat(closes)) return null
  return { closes, volumes }
}

// ---- CoinGecko (fallback) ----
type MarketChart = { prices: [number, number][]; total_volumes: [number, number][] }
function cgHeaders() {
  const apiKey = process.env.COINGECKO_API_KEY || ''
  const h: Record<string, string> = { 'cache-control': 'no-cache' }
  if (apiKey) h['x-cg-demo-api-key'] = apiKey
  return h
}
async function coingeckoFetchOne(id: string): Promise<MarketData | null> {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=200&interval=daily`
  const r = await fetch(url, { headers: cgHeaders() })
  if (!r.ok) return null
  const j = (await r.json()) as MarketChart
  const closes = (j.prices || []).map(p => Number(p[1])).filter(Number.isFinite)
  const volumes = (j.total_volumes || []).map(v => Number(v[1])).filter(Number.isFinite)
  if (closes.length < 50) return null
  if (isSeriesFlat(closes)) return null
  return { closes, volumes }
}
async function coingeckoWithAliases(aliases: string[]): Promise<MarketData | null> {
  for (const id of aliases) {
    const got = await coingeckoFetchOne(id)
    if (got) return got
  }
  return null
}

// ---- Heuristische fallback voor missing mapping
function guessIdFromBase(base: string): string | null {
  const b = base.toLowerCase()
  const m: Record<string, string> = {
    icp: 'internet-computer',
    xlm: 'stellar',
    fil: 'filecoin',
    algo: 'algorand',
    qnt: 'quant',
    theta: 'theta-token',
    stx: 'stacks',
    ton: 'toncoin',
    arb: 'arbitrum',
    op: 'optimism',
    inj: 'injective-protocol',
    apt: 'aptos',
    sui: 'sui',
    pepe: 'pepe',
  }
  return m[b] ?? null
}

// ---------- derive indicators (✅ unified TA) ----------
function computeIndicators(closes: number[], volumes: number[]) {
  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)
  const cross: 'Golden Cross' | 'Death Cross' | '—' =
    ma50 != null && ma200 != null
      ? ma50 > ma200
        ? 'Golden Cross'
        : ma50 < ma200
          ? 'Death Cross'
          : '—'
      : '—'

  const rsi = rsiWilder(closes, 14)
  const macd = macdCalc(closes, 12, 26, 9)

  const volume = volumes.at(-1) ?? null
  const avg20d = avgVolume(volumes, 20)
  const ratio = volume != null && avg20d != null && avg20d > 0 ? volume / avg20d : null

  const trend = latestTrendFeatures(closes, 20)
  const st = latestVolatilityFeatures(closes, 20).stdev20
  let regime: 'low' | 'med' | 'high' | '—' = '—'
  if (st != null) regime = st < 0.01 ? 'low' : st < 0.02 ? 'med' : 'high'

  const last = closes.at(-1) ?? null
  const pct = (from?: number, to?: number) => (from && to ? ((to - from) / from) * 100 : null)
  const perf = {
    d: pct(closes.at(-2) ?? undefined, last ?? undefined),
    w: pct(closes.at(-8) ?? undefined, last ?? undefined),
    m: pct(closes.at(-31) ?? undefined, last ?? undefined),
    q: pct(closes.at(-91) ?? undefined, last ?? undefined),
  }

  return {
    ma: { ma50, ma200, cross },
    rsi,
    macd,
    volume: { volume, avg20d, ratio },
    trend,
    volatility: { stdev20: st ?? null, regime },
    perf,
  }
}

type UiStatus = 'BUY' | 'HOLD' | 'SELL'
function statusFromScore(score: number): UiStatus {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

// ---------- symbol mapping helpers ----------
function symbolToOkx(symUSDT: string) {
  const base = symUSDT.replace(/USDT$/, '')
  if (!base) return null
  return `${base}-USDT`
}
function symbolToBitfinex(symUSDT: string) {
  const base = symUSDT.replace(/USDT$/, '')
  return [`t${base}USD`, `t${base}UST`]
}

// per-coin bronoverride (klein allowlistje om platte feeds te omzeilen)
const SOURCE_OVERRIDE: Record<string, 'okx' | 'bitfinex' | 'coingecko'> = {
  VETUSDT: 'coingecko',
  MKRUSDT: 'coingecko',
  KASUSDT: 'coingecko',
  JASMYUSDT: 'coingecko',
  BONKUSDT: 'coingecko',
  SEIUSDT: 'coingecko',
}

// ---------- fetch chain for one symbol ----------
async function fetchMarketDataFor(symUSDT: string): Promise<
  { ok: true; data: MarketData; source: string } | { ok: false; error: string }
> {
  const override = SOURCE_OVERRIDE[symUSDT]
  if (override === 'coingecko') {
    const aliases = CG_ALIASES[symUSDT] || [symUSDT.replace(/USDT$/, '').toLowerCase()]
    try {
      const d = await coingeckoWithAliases(aliases)
      if (d) return { ok: true, data: d, source: 'coingecko:override' }
    } catch {}
  } else if (override === 'okx') {
    const okxId = symbolToOkx(symUSDT)
    if (okxId) {
      try {
        const d = await okxFetch(okxId)
        if (d) return { ok: true, data: d, source: 'okx:override' }
      } catch {}
    }
  } else if (override === 'bitfinex') {
    const tSymbols = symbolToBitfinex(symUSDT)
    for (const t of tSymbols) {
      try {
        const d = await bitfinexFetch(t)
        if (d) return { ok: true, data: d, source: `bitfinex:override:${t}` }
      } catch {}
    }
  }

  const okxId = symbolToOkx(symUSDT)
  if (okxId) {
    try {
      const d = await okxFetch(okxId)
      if (d) return { ok: true, data: d, source: 'okx' }
    } catch {}
  }

  const tSymbols = symbolToBitfinex(symUSDT)
  for (const t of tSymbols) {
    try {
      const d = await bitfinexFetch(t)
      if (d) return { ok: true, data: d, source: `bitfinex:${t}` }
    } catch {}
  }

  let aliases = CG_ALIASES[symUSDT]
  if (!aliases || aliases.length === 0) {
    const base = symUSDT.replace(/USDT$/, '')
    const guess = guessIdFromBase(base)
    if (guess) aliases = [guess]
  }
  if (aliases?.length) {
    try {
      const d = await coingeckoWithAliases(aliases)
      if (d) return { ok: true, data: d, source: 'coingecko' }
    } catch {}
  }

  return { ok: false, error: 'No source returned data' }
}

// ---------- batching ----------
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ---------- API handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    cache5min(res, 300, 1800)

    const symbolsParam = String(req.query.symbols || '').trim()
    if (!symbolsParam) return res.status(400).json({ error: 'Missing ?symbols=BTCUSDT,ETHUSDT' })
    const debug = String(req.query.debug || '') === '1'

    // ✅ bump versie zodat KV cache zeker vernieuwt na deze wijziging
    const kvKey = snapKey.cryptoInd('v4:' + encodeURIComponent(symbolsParam) + (debug ? ':dbg1' : ''))

    const compute = async () => {
      const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      const dbg = debug ? { requested: symbols, used: [] as any[], missing: [] as string[] } : null

      const batches = chunk(symbols, 3)
      const results: any[] = []

      for (let bi = 0; bi < batches.length; bi++) {
        const group = batches[bi]
        const groupResults = await Promise.all(
          group.map(async (sym) => {
            const got = await fetchMarketDataFor(sym)
            dbg?.used.push({ symbol: sym, ok: got.ok, source: (got as any).source ?? null })
            if (got.ok === false) return { symbol: sym, error: got.error }

            try {
              const ind = computeIndicators(got.data.closes, got.data.volumes)

              // ✅ unified scoring (same engine as equities snapshot.ts)
              const overall = computeScoreStatus({
                ma: { ma50: ind.ma?.ma50 ?? null, ma200: ind.ma?.ma200 ?? null },
                rsi: ind.rsi ?? null,
                macd: { hist: ind.macd?.hist ?? null },
                volume: { ratio: ind.volume?.ratio ?? null },
                trend: ind.trend ?? null,
                volatility: { stdev20: ind.volatility?.stdev20 ?? null },
              })

              const score = typeof overall.score === 'number' && Number.isFinite(overall.score) ? overall.score : 50
              const status: UiStatus =
                (overall as any).status === 'BUY' || (overall as any).status === 'SELL' || (overall as any).status === 'HOLD'
                  ? (overall as any).status
                  : statusFromScore(score)

              return { symbol: sym, ...ind, score, status }
            } catch (e: any) {
              return { symbol: sym, error: e?.message || 'Compute failed' }
            }
          })
        )

        results.push(...groupResults)
        if (bi < batches.length - 1) await sleep(650)
      }

      if (debug) return { debug: dbg, results }
      return { results }
    }

    const { data } = await getOrRefreshSnap(kvKey, compute)
    return res.status(200).json(data)
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}
