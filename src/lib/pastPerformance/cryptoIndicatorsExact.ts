// src/lib/pastPerformance/cryptoIndicatorsExact.ts
// NOTE: This file intentionally mirrors the existing logic from:
// src/pages/api/crypto-light/indicators.ts
// We DO NOT modify the original calculation code; we copy it here for reuse.

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

// ⬇️ detect “platte” reeksen en forceer fallback
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

// ---------- tiny TA utils (EXACT) ----------
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

// ---------- indicators (EXACT) ----------
export function computeIndicators(closes: number[], volumes: number[]) {
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

// override allowlist (same as existing file)
const SOURCE_OVERRIDE: Record<string, 'okx' | 'bitfinex' | 'coingecko'> = {
  VETUSDT:  'coingecko',
  MKRUSDT:  'coingecko',
  KASUSDT:  'coingecko',
  JASMYUSDT:'coingecko',
  BONKUSDT: 'coingecko',
  SEIUSDT:  'coingecko',
}

// Heuristic fallback (same)
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

// ---------- market data (same chain, but returns times too) ----------
export type MarketData = { times: number[]; closes: number[]; volumes: number[] }

function cgHeaders() {
  const apiKey = process.env.COINGECKO_API_KEY || ''
  const h: Record<string,string> = { 'cache-control': 'no-cache' }
  if (apiKey) h['x-cg-demo-api-key'] = apiKey
  return h
}

async function okxFetch(instId: string, limit = 900): Promise<MarketData | null> {
  const lim = Math.max(50, Math.min(1000, Math.floor(limit)))
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=1D&limit=${lim}`
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) return null
  const j = await r.json()
  const arr: any[] = Array.isArray(j?.data) ? j.data : []
  if (!arr.length) return null
  const rows = arr.slice().reverse()
  const times = rows.map(x => Number(x?.[0])).filter(Number.isFinite)
  const closes = rows.map(x => Number(x?.[4])).filter(Number.isFinite)
  const volumes = rows.map(x => Number(x?.[5])).filter(Number.isFinite)
  if (closes.length < 50) return null
  if (isSeriesFlat(closes)) return null
  return { times, closes, volumes }
}

async function bitfinexFetch(tSymbol: string, limit = 900): Promise<MarketData | null> {
  const lim = Math.max(50, Math.min(5000, Math.floor(limit)))
  const url = `https://api-pub.bitfinex.com/v2/candles/trade:1D:${encodeURIComponent(tSymbol)}/hist?limit=${lim}`
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) return null
  const arr: any[] = await r.json()
  if (!Array.isArray(arr) || !arr.length) return null
  const rows = arr.slice().reverse()
  const times = rows.map(x => Number(x?.[0])).filter(Number.isFinite)
  const closes = rows.map(x => Number(x?.[2])).filter(Number.isFinite)
  const volumes = rows.map(x => Number(x?.[5])).filter(Number.isFinite)
  if (closes.length < 50) return null
  if (isSeriesFlat(closes)) return null
  return { times, closes, volumes }
}

type MarketChart = { prices: [number, number][]; total_volumes: [number, number][] }
async function coingeckoFetchOne(id: string, days = 900): Promise<MarketData | null> {
  const d = Math.max(50, Math.min(2000, Math.floor(days)))
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${d}&interval=daily`
  const r = await fetch(url, { headers: cgHeaders() })
  if (!r.ok) return null
  const j = (await r.json()) as MarketChart
  const times = (j.prices || []).map(p => Number(p[0])).filter(Number.isFinite)
  const closes = (j.prices || []).map(p => Number(p[1])).filter(Number.isFinite)
  const volumes = (j.total_volumes || []).map(v => Number(v[1])).filter(Number.isFinite)
  if (closes.length < 50) return null
  if (isSeriesFlat(closes)) return null
  return { times, closes, volumes }
}

async function coingeckoWithAliases(aliases: string[], days = 900): Promise<MarketData | null> {
  for (const id of aliases) {
    const got = await coingeckoFetchOne(id, days)
    if (got) return got
  }
  return null
}

// ---------- fetch chain for one symbol (same order + overrides) ----------
export async function fetchMarketDataFor(symUSDT: string, opts?: { limit?: number }): Promise<
  { ok: true; data: MarketData; source: string } | { ok: false; error: string }
> {
  const limit = Math.max(200, Math.min(1200, Math.floor(opts?.limit ?? 900)))

  // 1) Optional override
  const override = SOURCE_OVERRIDE[symUSDT]
  if (override === 'coingecko') {
    const aliases = CG_ALIASES[symUSDT] || [symUSDT.replace(/USDT$/, '').toLowerCase()]
    try {
      const d = await coingeckoWithAliases(aliases, limit)
      if (d) return { ok: true, data: d, source: 'coingecko:override' }
    } catch {}
  } else if (override === 'okx') {
    const okxId = symbolToOkx(symUSDT)
    if (okxId) {
      try {
        const d = await okxFetch(okxId, limit)
        if (d) return { ok: true, data: d, source: 'okx:override' }
      } catch {}
    }
  } else if (override === 'bitfinex') {
    const tSymbols = symbolToBitfinex(symUSDT)
    for (const t of tSymbols) {
      try {
        const d = await bitfinexFetch(t, limit)
        if (d) return { ok: true, data: d, source: `bitfinex:override:${t}` }
      } catch {}
    }
  }

  // 2) Normal chain
  const okxId = symbolToOkx(symUSDT)
  if (okxId) {
    try {
      const d = await okxFetch(okxId, limit)
      if (d) return { ok: true, data: d, source: 'okx' }
    } catch {}
  }

  const tSymbols = symbolToBitfinex(symUSDT)
  for (const t of tSymbols) {
    try {
      const d = await bitfinexFetch(t, limit)
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
      const d = await coingeckoWithAliases(aliases, limit)
      if (d) return { ok: true, data: d, source: 'coingecko' }
    } catch {}
  }

  return { ok: false, error: 'No source returned data' }
}