// src/pages/api/crypto-light/indicators.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'

// ---------- helpers (general) ----------
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

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
  ARBUSDT:  ['arbitrum'],
  OPUSDT:   ['optimism'],
  INJUSDT:  ['injective-protocol'],
  APTUSDT:  ['aptos'],
  SUIUSDT:  ['sui'],
  SHIBUSDT: ['shiba-inu'],
  VETUSDT:  ['vechain'],
  EGLDUSDT: ['multiversx'],
  IMXUSDT:  ['immutable-x'],
  GRTUSDT:  ['the-graph'],
  STXUSDT:  ['stacks', 'blockstack'],
  RUNEUSDT: ['thorchain'],
  RNDRUSDT: ['render-token'],
  AAVEUSDT: ['aave'],
  MKRUSDT:  ['maker'],
  UNIUSDT:  ['uniswap'],
  FLOWUSDT: ['flow'],
  CHZUSDT:  ['chiliz'],
  MANAUSDT: ['decentraland'],
  SANDUSDT: ['the-sandbox'],
  AXSUSDT:  ['axie-infinity'],
  DYDXUSDT: ['dydx-chain', 'dydx'],
  KASUSDT:  ['kaspa'],
  SEIUSDT:  ['sei-network', 'sei'],
  BONKUSDT: ['bonk'],
  JASMYUSDT:['jasmycoin'],
  FTMUSDT:  ['fantom'],
  PEPEUSDT: ['pepe'],
  ICPUSDT:  ['internet-computer'],
  FILUSDT:  ['filecoin'],
  ALGOUSDT: ['algorand'],
  QNTUSDT:  ['quant', 'quant-network'],
  THETAUSDT:['theta-token'],
}

// ---------- tiny TA utils ----------
const sma = (arr: number[], win: number): number | null => {
  if (arr.length < win) return null
  let s = 0
  for (let i = arr.length - win; i < arr.length; i++) s += arr[i]
  return s / win
}
const stdev = (arr: number[]): number | null => {
  if (arr.length === 0) return null
  const m = arr.reduce((a, b) => a + b, 0) / arr.length
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length
  return Math.sqrt(v)
}
const rsi14 = (closes: number[]): number | null => {
  if (closes.length < 15) return null
  let gains = 0, losses = 0
  for (let i = closes.length - 14; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1]
    if (ch >= 0) gains += ch
    else losses -= ch
  }
  const avgG = gains / 14
  const avgL = losses / 14
  if (avgL === 0) return 100
  const rs = avgG / avgL
  return clamp(100 - 100 / (1 + rs), 0, 100)
}
const macdCalc = (closes: number[], fast = 12, slow = 26, sig = 9) => {
  if (closes.length < slow) return { macd: null as number | null, signal: null as number | null, hist: null as number | null }
  const kF = 2 / (fast + 1), kS = 2 / (slow + 1)
  let emaF = closes.slice(0, fast).reduce((a, b) => a + b, 0) / fast
  let emaS = closes.slice(0, slow).reduce((a, b) => a + b, 0) / slow
  for (let i = fast; i < slow; i++) emaF = closes[i] * kF + emaF * (1 - kF)
  const macdSeries: number[] = []
  for (let i = slow; i < closes.length; i++) {
    emaF = closes[i] * kF + emaF * (1 - kF)
    emaS = closes[i] * kS + emaS * (1 - kS)
    macdSeries.push(emaF - emaS)
  }
  const macd = macdSeries.at(-1) ?? null
  if (macdSeries.length < sig) return { macd, signal: null, hist: null }
  const kSig = 2 / (sig + 1)
  let signal = macdSeries.slice(0, sig).reduce((a, b) => a + b, 0) / sig
  for (let i = sig; i < macdSeries.length; i++) signal = macdSeries[i] * kSig + signal * (1 - kSig)
  const hist = macd != null && signal != null ? macd - signal : null
  return { macd, signal, hist }
}

// ---------- market data fetchers (OKX -> Bitfinex -> CoinGecko) ----------
type MarketData = { closes: number[]; volumes: number[] }

async function okxFetch(instId: string): Promise<MarketData | null> {
  // OKX bar=1D (200 candles)
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=1D&limit=200`
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) return null
  const j = await r.json()
  const arr: any[] = Array.isArray(j?.data) ? j.data : []
  if (!arr.length) return null
  // OKX row: [ts, o, h, l, c, vol, ...] — take close idx 4, volume idx 5, reverse to oldest→newest
  const rows = arr.slice().reverse()
  const closes = rows.map(x => Number(x?.[4])).filter(Number.isFinite)
  const volumes = rows.map(x => Number(x?.[5])).filter(Number.isFinite)
  if (closes.length < 50) return null
  return { closes, volumes }
}

async function bitfinexFetch(tSymbol: string): Promise<MarketData | null> {
  // Bitfinex: /v2/candles/trade:1D:tBTCUSD/hist
  const url = `https://api-pub.bitfinex.com/v2/candles/trade:1D:${encodeURIComponent(tSymbol)}/hist?limit=200`
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) return null
  const arr: any[] = await r.json()
  if (!Array.isArray(arr) || !arr.length) return null
  // Row: [MTS, OPEN, CLOSE, HIGH, LOW, VOLUME]
  const rows = arr.slice().reverse()
  const closes = rows.map(x => Number(x?.[2])).filter(Number.isFinite)
  const volumes = rows.map(x => Number(x?.[5])).filter(Number.isFinite)
  if (closes.length < 50) return null
  return { closes, volumes }
}

// ---- CoinGecko (fallback) ----
type MarketChart = { prices: [number, number][]; total_volumes: [number, number][] }
function cgHeaders() {
  const apiKey = process.env.COINGECKO_API_KEY || ''
  const h: Record<string,string> = { 'cache-control': 'no-cache' }
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
  const m: Record<string,string> = {
    icp: 'internet-computer',
    xlm: 'stellar',
    fil: 'filecoin',
    algo: 'algorand',
    qnt: 'quant',
    theta: 'theta-token',
    stx: 'stacks',
    ton: 'toncoin',
    arb: 'arbitrum',
    op:  'optimism',
    inj: 'injective-protocol',
    apt: 'aptos',
    sui: 'sui',
    pepe:'pepe',
  }
  return m[b] ?? null
}

// ---------- derive indicators + score ----------
function computeIndicators(closes: number[], volumes: number[]) {
  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)
  const cross: 'Golden Cross' | 'Death Cross' | '—' =
    ma50 != null && ma200 != null ? (ma50 > ma200 ? 'Golden Cross' : ma50 < ma200 ? 'Death Cross' : '—') : '—'
  const rsi = rsi14(closes)
  const macd = macdCalc(closes, 12, 26, 9)
  const volume = volumes.at(-1) ?? null
  const avg20d = sma(volumes, 20)
  const ratio = volume != null && avg20d != null && avg20d > 0 ? volume / avg20d : null

  // Volatility (stdev(20) van dagrendementen)
  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1], b = closes[i]
    if (a > 0 && Number.isFinite(a) && Number.isFinite(b)) rets.push((b - a) / a)
  }
  const st = stdev(rets.slice(-20))
  let regime: 'low'|'med'|'high'|'—' = '—'
  if (st != null) regime = st < 0.01 ? 'low' : st < 0.02 ? 'med' : 'high'

  // Perf (d/w/m/q) optioneel (niet gebruikt voor score hier)
  const last = closes.at(-1) ?? null
  const pct = (from?: number, to?: number) => (from && to) ? ((to - from) / from) * 100 : null
  const perf = {
    d: pct(closes.at(-2), last),
    w: pct(closes.at(-8), last),
    m: pct(closes.at(-31), last),
    q: pct(closes.at(-91), last),
  }

  return {
    ma: { ma50, ma200, cross },
    rsi,
    macd,
    volume: { volume, avg20d, ratio },
    volatility: { stdev20: st ?? null, regime },
    perf,
  }
}

type UiStatus = 'BUY'|'HOLD'|'SELL'
function statusFromScore(score: number): UiStatus {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}
function taScoreFrom(ind: {
  ma?: { ma50: number|null; ma200: number|null }
  rsi?: number|null
  macd?: { hist: number|null }
  volume?: { ratio: number|null }
}) {
  const clamp = (n:number,a:number,b:number)=>Math.max(a,Math.min(b,n))
  // MA (35%)
  let maScore = 50
  if (ind.ma?.ma50 != null && ind.ma?.ma200 != null) {
    if (ind.ma.ma50 > ind.ma.ma200) {
      const spread = clamp(ind.ma.ma50 / Math.max(1e-9, ind.ma.ma200) - 1, 0, 0.2)
      maScore = 60 + (spread / 0.2) * 40
    } else if (ind.ma.ma50 < ind.ma.ma200) {
      const spread = clamp(ind.ma.ma200 / Math.max(1e-9, ind.ma.ma50) - 1, 0, 0.2)
      maScore = 40 - (spread / 0.2) * 40
    }
  }
  // RSI (25%)
  let rsiScore = 50
  if (typeof ind.rsi === 'number') rsiScore = clamp(((ind.rsi - 30) / 40) * 100, 0, 100)
  // MACD (25%)
  let macdScore = 50
  const hist = ind.macd?.hist
  if (typeof hist === 'number') macdScore = hist > 0 ? 70 : hist < 0 ? 30 : 50
  // Volume (15%)
  let volScore = 50
  const ratio = ind.volume?.ratio
  if (typeof ratio === 'number') volScore = clamp((ratio / 2) * 100, 0, 100)

  const score = Math.round(clamp(0.35 * maScore + 0.25 * rsiScore + 0.25 * macdScore + 0.15 * volScore, 0, 100))
  return { score, status: statusFromScore(score) as UiStatus }
}

// ---------- symbol mapping helpers ----------
function symbolToOkx(symUSDT: string) {
  // BTCUSDT -> BTC-USDT
  const base = symUSDT.replace(/USDT$/,'')
  if (!base) return null
  return `${base}-USDT`
}
function symbolToBitfinex(symUSDT: string) {
  // Try USD first, then UST (Tether legacy code on Bitfinex)
  const base = symUSDT.replace(/USDT$/,'')
  return [`t${base}USD`, `t${base}UST`]
}

// ---------- fetch chain for one symbol ----------
async function fetchMarketDataFor(symUSDT: string): Promise<
  { ok: true; data: MarketData; source: string } | { ok: false; error: string }
> {
  // A) OKX
  const okxId = symbolToOkx(symUSDT)
  if (okxId) {
    try {
      const d = await okxFetch(okxId)
      if (d) return { ok: true, data: d, source: 'okx' }
    } catch {}
  }

  // B) Bitfinex
  const tSymbols = symbolToBitfinex(symUSDT)
  for (const t of tSymbols) {
    try {
      const d = await bitfinexFetch(t)
      if (d) return { ok: true, data: d, source: `bitfinex:${t}` }
    } catch {}
  }

  // C) CoinGecko
  let aliases = CG_ALIASES[symUSDT]
  if (!aliases || aliases.length === 0) {
    const base = symUSDT.replace(/USDT$/,'')
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
    const symbolsParam = String(req.query.symbols || '').trim()
    if (!symbolsParam) return res.status(400).json({ error: 'Missing ?symbols=BTCUSDT,ETHUSDT' })
    const debug = String(req.query.debug || '') === '1'

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    const dbg = debug ? { requested: symbols, used: [] as any[], missing: [] as string[] } : null

    // gentle throttle to avoid rate-limits on free sources
    const batches = chunk(symbols, 3)
    const results: any[] = []

    for (let bi = 0; bi < batches.length; bi++) {
      const group = batches[bi]

      const groupResults = await Promise.all(group.map(async (sym) => {
        // Try OKX -> Bitfinex -> CoinGecko
        const got = await fetchMarketDataFor(sym)
        dbg?.used.push({ symbol: sym, ok: got.ok, source: (got as any).source ?? null })

        // ✅ TypeScript narrowing fix
        if (got.ok === false) {
          return { symbol: sym, error: got.error }
        }

        try {
          const ind = computeIndicators(got.data.closes, got.data.volumes)
          const { score, status } = taScoreFrom({
            ma: ind.ma,
            rsi: ind.rsi,
            macd: ind.macd,
            volume: ind.volume,
          })
          return { symbol: sym, ...ind, score, status }
        } catch (e: any) {
          return { symbol: sym, error: e?.message || 'Compute failed' }
        }
      }))

      results.push(...groupResults)

      // sleep between batches (except after last)
      if (bi < batches.length - 1) await sleep(650)
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800')
    if (debug) return res.status(200).json({ debug: dbg, results })
    return res.status(200).json({ results })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}