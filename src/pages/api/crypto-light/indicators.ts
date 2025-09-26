// bovenaan het bestand
export const config = { runtime: 'nodejs' }

// src/pages/api/crypto-light/indicators.ts
import type { NextApiRequest, NextApiResponse } from 'next'

// ---- Binance-style symbol -> CoinGecko ID mapping ----
// Vul aan met alle symbolen die je gebruikt (zelfde lijst als bij prices).
const CG: Record<string, string> = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  BNBUSDT: 'binancecoin',
  SOLUSDT: 'solana',
  XRPUSDT: 'ripple',
  ADAUSDT: 'cardano',
  DOGEUSDT: 'dogecoin',
  TRXUSDT: 'tron',
  TONUSDT: 'toncoin',
  AVAXUSDT: 'avalanche-2',
  MATICUSDT: 'matic-network',
  DOTUSDT: 'polkadot',
  LTCUSDT: 'litecoin',
  BCHUSDT: 'bitcoin-cash',
  LINKUSDT: 'chainlink',
  XLMUSDT: 'stellar',
  NEARUSDT: 'near',
  ATOMUSDT: 'cosmos',
  ETCUSDT: 'ethereum-classic',
  XMRUSDT: 'monero',
  // ... voeg je overige coins toe
}

// ---- kleine math helpers (geen externe lib nodig) ----
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
const pct = (from?: number | null, to?: number | null): number | null => {
  if (from == null || to == null || !isFinite(from) || from === 0) return null
  return ((to - from) / from) * 100
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

  const kF = 2 / (fast + 1)
  const kS = 2 / (slow + 1)

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

// ---- CoinGecko fetch ----
type MarketChart = { prices: [number, number][]; total_volumes: [number, number][] }
async function fetchMarketChart(id: string, days = 200): Promise<{ closes: number[]; volumes: number[] }> {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) throw new Error(`CG ${id} HTTP ${r.status}`)
  const j = (await r.json()) as MarketChart
  const closes = (j.prices || []).map(p => Number(p[1])).filter(v => Number.isFinite(v))
  const volumes = (j.total_volumes || []).map(v => Number(v[1])).filter(v => Number.isFinite(v))
  return { closes, volumes }
}

// ---- compute set of indicators ----
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

  // Volatility regime (proxy): stdev over 20 dagrendementen
  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]
    const cur = closes[i]
    if (prev > 0 && isFinite(prev) && isFinite(cur)) rets.push((cur / prev) - 1)
  }
  const stdev20 = rets.length >= 20 ? stdev(rets.slice(-20)) : null
  let regime: 'low' | 'med' | 'high' | '—' = '—'
  if (stdev20 != null) {
    const p = stdev20 * 100 // in %
    regime = p < 1 ? 'low' : p < 3 ? 'med' : 'high'
  }

  // Performance (in %): 24h / 7d / 30d / 90d
  const last = closes.at(-1) ?? null
  const prev = closes.at(-2) ?? null
  const c7   = closes.at(-8) ?? null
  const c30  = closes.at(-31) ?? null
  const c90  = closes.at(-91) ?? null

  return {
    // bestaand: front-end gebruikt deze velden
    ma: { ma50, ma200, cross },
    rsi,
    macd,
    volume: { volume, avg20d, ratio },

    // nieuw: optioneel te tonen
    volatility: { stdev20, regime },
    perf: {
      d: pct(prev, last),
      w: pct(c7, last),
      m: pct(c30, last),
      q: pct(c90, last),
    },
  }
}

// ---- batched helper om rate limit te vriend te houden ----
async function mapBatched<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size)
    const res = await Promise.all(chunk.map(fn))
    out.push(...res)
  }
  return out
}

// ---- API handler (zelfde shape als jouw huidige endpoint) ----
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbolsParam = String(req.query.symbols || '').trim()
    if (!symbolsParam) return res.status(400).json({ error: 'Missing ?symbols=BTCUSDT,ETHUSDT' })

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    const pairs = symbols
      .map(sym => ({ sym, id: CG[sym] }))
      .filter(p => !!p.id) as { sym: string; id: string }[]

    const results = await mapBatched(pairs, 5, async ({ sym, id }) => {
      try {
        const { closes, volumes } = await fetchMarketChart(id, 200)
        if (closes.length === 0) throw new Error('No data')
        const ind = computeIndicators(closes, volumes)
        return { symbol: sym, ...ind }
      } catch (e: any) {
        return { symbol: sym, error: e?.message || 'Failed' }
      }
    })

    // nette cache voor Vercel (5 min) + SWR backfill
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800')
    return res.status(200).json({ results })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}