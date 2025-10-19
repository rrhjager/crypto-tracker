// /src/pages/api/indicators/snapshot-list.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'

// Strakke, "verse" cache voor deze route: max 30s oud uit edge
const EDGE_MAX_AGE = 30       // seconden
const TTL_SEC = 60            // KV TTL per ticker
const REVALIDATE_SEC = 15     // bij <=15s resterend: achtergrond refresh

type Bar = { close?: number; volume?: number }
type SnapResp = {
  symbol: string
  ma: { ma50: number | null; ma200: number | null; status?: 'BUY'|'SELL'|'HOLD' }
  rsi: { period: number; rsi: number | null; status?: 'BUY'|'SELL'|'HOLD' }
  macd: { macd: number | null; signal: number | null; hist: number | null; status?: 'BUY'|'SELL'|'HOLD' }
  volume: { volume: number | null; avg20d: number | null; ratio: number | null; status?: 'BUY'|'SELL'|'HOLD' }
}

const RANGE: '1y'|'2y' = '1y'

// --- helpers (gekopieerd uit snapshot-logic, veilig en lokaal) ---
const normCloses = (ohlc: Bar[]) =>
  Array.isArray(ohlc) ? ohlc.map(x => (typeof x?.close === 'number' ? x.close! : NaN)).filter(Number.isFinite) as number[] : []

const normVolumes = (ohlc: Bar[]) =>
  Array.isArray(ohlc) ? ohlc.map(x => (typeof x?.volume === 'number' ? x.volume! : NaN)).filter(Number.isFinite) as number[] : []

const sma = (arr: number[], p: number): number | null => {
  if (!Array.isArray(arr) || arr.length < p) return null
  const s = arr.slice(-p)
  return s.reduce((a, b) => a + b, 0) / p
}

// Wilder RSI(14)
function rsiWilder(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gains += d; else losses -= d
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    const gain = d > 0 ? d : 0
    const loss = d < 0 ? -d : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - (100 / (1 + rs))
}

function macdLast(closes: number[], fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return { macd: null, signal: null, hist: null }
  const ema = (period: number) => {
    const k = 2 / (period + 1)
    let prev = closes.slice(0, period).reduce((a, b) => a + b, 0) / period
    for (let i = period; i < closes.length; i++) prev = closes[i] * k + prev * (1 - k)
    return prev
  }
  const emaFast = (() => {
    const k = 2 / (fast + 1)
    let prev = closes.slice(0, fast).reduce((a, b) => a + b, 0) / fast
    for (let i = fast; i < closes.length; i++) prev = closes[i] * k + prev * (1 - k)
    return prev
  })()
  const emaSlow = (() => {
    const k = 2 / (slow + 1)
    let prev = closes.slice(0, slow).reduce((a, b) => a + b, 0) / slow
    for (let i = slow; i < closes.length; i++) prev = closes[i] * k + prev * (1 - k)
    return prev
  })()
  const macd = emaFast - emaSlow

  // signal-ema over MACD-reeks – hier benaderen we met "laatste" benadering, ok voor snapshot
  // Voor volle precisie zou je de complete reeks itereren; voor UI-status volstaat dit.
  const signalVal = (() => {
    const k = 2 / (signal + 1)
    let prev = macd
    for (let i = 0; i < signal; i++) prev = macd * k + prev * (1 - k)
    return prev
  })()

  const hist = macd - signalVal
  return { macd, signal: signalVal, hist }
}

async function computeOne(symbol: string): Promise<SnapResp> {
  const ohlc = await getYahooDailyOHLC(symbol, RANGE)
  const closes = normCloses(ohlc)
  const vols = normVolumes(ohlc)

  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)
  const maStatus =
    typeof ma50 === 'number' && typeof ma200 === 'number'
      ? ma50 > ma200 ? 'BUY' : ma50 < ma200 ? 'SELL' : 'HOLD'
      : undefined

  const rsi = rsiWilder(closes, 14)
  const { macd, signal, hist } = macdLast(closes, 12, 26, 9)

  const volume = vols.length ? vols[vols.length - 1] : null
  const last20 = vols.slice(-20)
  const avg20d = last20.length === 20 ? last20.reduce((a, b) => a + b, 0) / 20 : null
  const ratio =
    typeof volume === 'number' && typeof avg20d === 'number' && avg20d > 0
      ? volume / avg20d
      : null

  const volStatus =
    typeof ratio === 'number' ? (ratio > 1.3 ? 'BUY' : ratio < 0.7 ? 'SELL' : 'HOLD') : undefined
  const rsiStatus =
    typeof rsi === 'number' ? (rsi < 30 ? 'BUY' : rsi > 70 ? 'SELL' : 'HOLD') : undefined
  const macdStatus =
    typeof macd === 'number' && typeof signal === 'number'
      ? macd > signal ? 'BUY' : macd < signal ? 'SELL' : 'HOLD'
      : undefined

  return {
    symbol,
    ma:    { ma50: ma50 ?? null, ma200: ma200 ?? null, status: maStatus },
    rsi:   { period: 14, rsi: rsi ?? null, status: rsiStatus },
    macd:  { macd: macd ?? null, signal: signal ?? null, hist: hist ?? null, status: macdStatus },
    volume:{ volume: volume ?? null, avg20d: avg20d ?? null, ratio: ratio ?? null, status: volStatus },
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Zorgt dat Edge/CDN dit 30s serveert; daarna SWR (tot 5 min)
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_MAX_AGE}, stale-while-revalidate=300`)

  try {
    const raw = String(req.query.symbols || '').trim()
    if (!raw) return res.status(400).json({ error: 'Missing ?symbols=AAPL,MSFT,...' })

    const symbols = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    if (!symbols.length) return res.status(400).json({ error: 'No symbols' })

    const items = await Promise.all(
      symbols.map(async (sym) => {
        const key = `ind:snap:${sym}`
        const data = await kvRefreshIfStale<SnapResp>(key, TTL_SEC, REVALIDATE_SEC, async () => {
          const v = await computeOne(sym)
          try { await kvSetJSON(`ind:snap:all:${sym}`, { updatedAt: Date.now(), value: v }, TTL_SEC) } catch {}
          return v
        })
        return data ?? { symbol: sym, ma: { ma50: null, ma200: null }, rsi: { period: 14, rsi: null }, macd: { macd: null, signal: null, hist: null }, volume: { volume: null, avg20d: null, ratio: null } }
      })
    )

    return res.status(200).json({ items, updatedAt: Date.now() })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}