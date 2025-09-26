// src/pages/api/crypto-light/indicators.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'

/* ----------------------- CG ALIASES (uitbreidbaar) ----------------------- */
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

  // extra's (zoals in je lijst)
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

  // expliciet gevraagd
  ICPUSDT:  ['internet-computer'],
  FILUSDT:  ['filecoin'],
  ALGOUSDT: ['algorand'],
  QNTUSDT:  ['quant', 'quant-network'],
  THETAUSDT:['theta-token'],
}

/* ---------------------------- TA mini helpers ---------------------------- */
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

/* ---------------------- Fetch helpers + Retry/backoff -------------------- */
function cgHeaders() {
  const apiKey = process.env.COINGECKO_API_KEY || ''
  const h: Record<string,string> = { 'cache-control': 'no-cache' }
  if (apiKey) h['x-cg-demo-api-key'] = apiKey
  return h
}

async function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms))
}

async function fetchJSONWithRetry(url: string, tries = 5) {
  let lastErr: any
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: cgHeaders() })
    if (r.ok) return r.json()
    const body = await r.text().catch(() => '')
    lastErr = new Error(`HTTP ${r.status} ${body}`)

    // backoff bij 429 / 5xx
    if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
      const base = 400 * Math.pow(2, i) // 400, 800, 1600, 3200, 6400
      const jitter = Math.floor(Math.random() * 250)
      await sleep(base + jitter)
      continue
    }
    break
  }
  throw lastErr
}

/* ---------------------- Market chart (flexible days) --------------------- */
type MarketChart = { prices: [number, number][], total_volumes: [number, number][] }

async function fetchMarketChartOne(id: string, days: number) {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`
  const j = await fetchJSONWithRetry(url, 5) as MarketChart
  const closes  = (j.prices || []).map(p => Number(p[1])).filter(Number.isFinite)
  const volumes = (j.total_volumes || []).map(v => Number(v[1])).filter(Number.isFinite)
  return { closes, volumes }
}

async function fetchChartFlexible(id: string) {
  let lastErr: any
  for (const d of [365, 200, 90]) {
    try { return await fetchMarketChartOne(id, d) } catch (e) { lastErr = e }
  }
  throw lastErr
}

async function fetchMarketChartWithAliases(aliases: string[]) {
  let lastErr: any = null
  for (const id of aliases) {
    try { const d = await fetchChartFlexible(id); return { ok: true as const, id, ...d } }
    catch (e) { lastErr = e }
  }
  return { ok: false as const, error: lastErr?.message || 'No data for any alias' }
}

/* ---------------------- Heuristische id-guess (backup) ------------------- */
function guessIdFromBase(base: string): string | null {
  const b = base.toLowerCase()
  const m: Record<string,string> = {
    icp: 'internet-computer',
    xlm: 'stellar',
    fil: 'filecoin',
    algo:'algorand',
    qnt: 'quant',
    theta:'theta-token',
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

/* -------------------------- Indicatoren (compute) ------------------------ */
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

  // stdev(20) van dagrendementen → regime
  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1], b = closes[i]
    if (a > 0 && Number.isFinite(a) && Number.isFinite(b)) rets.push((b - a) / a)
  }
  const st = stdev(rets.slice(-20))
  let regime: 'low'|'med'|'high'|'—' = '—'
  if (st != null) regime = st < 0.01 ? 'low' : st < 0.02 ? 'med' : 'high'

  // performance uit closes (24h/7d/30d/90d)
  const last = closes.at(-1) ?? null
  const pct = (from?: number, to?: number) => (from && to) ? ((to - from) / from) * 100 : null
  const perf = {
    d: pct(closes.at(-2),  last),
    w: pct(closes.at(-8),  last),
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

/* -------------------------------- Batching ------------------------------- */
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/* -------------------------------- Handler -------------------------------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbolsParam = String(req.query.symbols || '').trim()
    if (!symbolsParam) return res.status(400).json({ error: 'Missing ?symbols=BTCUSDT,ETHUSDT' })
    const debug = String(req.query.debug || '') === '1'

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    const dbg = debug ? { requested: symbols, used: [] as any[], missing: [] as string[] } : null

    const results: any[] = []
    // kleinere batches + korte pauze → minder 429
    for (const group of chunk(symbols, 3)) {
      const part = await Promise.all(group.map(async (sym) => {
        let aliases = CG_ALIASES[sym]
        if (!aliases || aliases.length === 0) {
          const base = sym.replace(/USDT$/,'')
          const guess = guessIdFromBase(base)
          if (guess) aliases = [guess]
        }
        if (!aliases?.length) {
          dbg?.missing.push(sym)
          return { symbol: sym, error: 'No CG mapping' }
        }

        const got = await fetchMarketChartWithAliases(aliases)
        dbg?.used.push({ symbol: sym, ok: got.ok, tried: aliases, chosen: (got as any).id ?? null })

        if (!got.ok) return { symbol: sym, error: (got as any).error || 'Fetch failed' }

        try {
          const ind = computeIndicators(got.closes, got.volumes)
          return { symbol: sym, ...ind }
        } catch (e: any) {
          return { symbol: sym, error: e?.message || 'Compute failed' }
        }
      }))
      results.push(...part)
      await sleep(350) // kleine pauze tussen batches
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800')
    if (debug) return res.status(200).json({ debug: dbg, results })
    return res.status(200).json({ results })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}