// src/pages/api/crypto-light/indicators.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'

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

  // extra's uit je lijst
  FLOWUSDT: ['flow'],
  CHZUSDT: ['chiliz'],
  MANAUSDT: ['decentraland'],
  SANDUSDT: ['the-sandbox'],
  AXSUSDT:  ['axie-infinity'],
  DYDXUSDT: ['dydx-chain', 'dydx'],
  STXUSDT:  ['stacks', 'blockstack'],
  KASUSDT:  ['kaspa'],
  SEIUSDT:  ['sei-network', 'sei'],
  BONKUSDT: ['bonk'],
  JASMYUSDT:['jasmycoin'],
  FTMUSDT:  ['fantom'],

  // ---- nieuw toegevoegd zoals gevraagd ----
  ICPUSDT:  ['internet-computer'],
  FILUSDT:  ['filecoin'],
  ALGOUSDT: ['algorand'],
  QNTUSDT:  ['quant', 'quant-network'],
  THETAUSDT:['theta-token'],
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
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

type MarketChart = { prices: [number, number][]; total_volumes: [number, number][] }

async function fetchMarketChartOne(id: string, days = 200): Promise<{ closes: number[]; volumes: number[] }> {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) throw new Error(`CG ${id} HTTP ${r.status}`)
  const j = (await r.json()) as MarketChart
  const closes = (j.prices || []).map(p => Number(p[1])).filter(Number.isFinite)
  const volumes = (j.total_volumes || []).map(v => Number(v[1])).filter(Number.isFinite)
  return { closes, volumes }
}

async function fetchMarketChartWithAliases(aliases: string[]) {
  let lastErr: any = null
  for (const id of aliases) {
    try {
      const d = await fetchMarketChartOne(id, 200)
      return { ok: true as const, id, ...d }
    } catch (e) { lastErr = e }
  }
  return { ok: false as const, error: lastErr?.message || 'No data for any alias' }
}

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

  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1], b = closes[i]
    if (a > 0 && Number.isFinite(a) && Number.isFinite(b)) rets.push((b - a) / a)
  }
  const st = stdev(rets.slice(-20))
  let regime: 'low'|'med'|'high'|'—' = '—'
  if (st != null) regime = st < 0.01 ? 'low' : st < 0.02 ? 'med' : 'high'

  const last = closes.at(-1) ?? null
  const p = (idxFromEnd: number) => {
    const ref = closes.at(-idxFromEnd) ?? null
    if (!last || !ref) return null
    return ((last - ref) / ref) * 100
  }
  const perf = { d: p(1), w: p(7 + 1), m: p(30 + 1), q: p(90 + 1) }

  return {
    ma: { ma50, ma200, cross },
    rsi,
    macd,
    volume: { volume, avg20d, ratio },
    volatility: { stdev20: st ?? null, regime },
    perf,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbolsParam = String(req.query.symbols || '').trim()
    if (!symbolsParam) return res.status(400).json({ error: 'Missing ?symbols=BTCUSDT,ETHUSDT' })
    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)

    const results = await Promise.all(symbols.map(async (sym) => {
      const aliases = CG_ALIASES[sym]
      if (!aliases?.length) return { symbol: sym, error: 'No CG mapping' }
      const got = await fetchMarketChartWithAliases(aliases)
      if (!got.ok) return { symbol: sym, error: got.error }
      try {
        const ind = computeIndicators(got.closes, got.volumes)
        return { symbol: sym, ...ind }
      } catch (e: any) {
        return { symbol: sym, error: e?.message || 'Compute failed' }
      }
    }))

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800')
    return res.status(200).json({ results })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}