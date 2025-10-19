import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON, kvRefreshIfStale } from '@/lib/kv'
import { getYahooDailyOHLC } from '@/lib/providers/quote'
import { maCross, rsi14, macd, vol20 } from '@/lib/ta'

type Advice = 'BUY' | 'HOLD' | 'SELL'
type Resp = { symbol: string; score: number|null; details?: any }
type Snap = { updatedAt: number; value: Resp }

const TTL_SEC = 300          // 5 min cache
const REVALIDATE_SEC = 30    // na 30s mag lazy refresh

// ==== helpers (zelfde logica als homepage) ====
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const scoreToPts = (s: number) => clamp((s / 100) * 4 - 2, -2, 2)
const toNum = (x: unknown) => (typeof x === 'string' ? Number(x) : (x as number))
const isFiniteNum = (x: unknown) => Number.isFinite(toNum(x))
const toPtsSmart = (status?: Advice | string, pts?: number | string | null, fallback: () => number | null = () => null) => {
  if (isFiniteNum(pts)) return clamp(toNum(pts), -2, 2)
  const s = String(status || '').toUpperCase()
  if (s === 'BUY')  return  2
  if (s === 'SELL') return -2
  const f = fallback()
  return f == null ? 0 : clamp(f, -2, 2)
}

function deriveMaPoints(ma?: { ma50: number|null; ma200: number|null }): number | null {
  const ma50 = ma?.ma50, ma200 = ma?.ma200
  if (ma50 == null || ma200 == null) return null
  let maScore = 50
  if (ma50 > ma200) {
    const spread = clamp(ma50 / Math.max(1e-9, ma200) - 1, 0, 0.2)
    maScore = 60 + (spread / 0.2) * 40
  } else if (ma50 < ma200) {
    const spread = clamp(ma200 / Math.max(1e-9, ma50) - 1, 0, 0.2)
    maScore = 40 - (spread / 0.2) * 40
  }
  return scoreToPts(maScore)
}
function deriveRsiPoints(r: number | null | undefined): number | null {
  if (typeof r !== 'number') return null
  const rsiScore = clamp(((r - 30) / 40) * 100, 0, 100)
  return scoreToPts(rsiScore)
}
function deriveMacdPoints(hist: number | null | undefined, ma50?: number | null): number | null {
  if (typeof hist !== 'number') return null
  if (ma50 && ma50 > 0) {
    const t = 0.01
    const relClamped = clamp((hist / ma50) / t, -1, 1)
    const macdScore = 50 + relClamped * 20
    return scoreToPts(macdScore)
  }
  const macdScore = hist > 0 ? 60 : hist < 0 ? 40 : 50
  return scoreToPts(macdScore)
}
function deriveVolPoints(ratio: number | null | undefined): number | null {
  if (typeof ratio !== 'number') return null
  const delta = clamp((ratio - 1) / 1, -1, 1)
  const volScore = clamp(50 + delta * 30, 0, 100)
  return scoreToPts(volScore)
}

export const config = { runtime: 'nodejs' }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbol = String(req.query.symbol || '').trim()
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

    const key = `ind:score:v1:${symbol}`
    const cached = await kvGetJSON<Snap>(key)
    const now = Date.now()

    if (cached?.value && cached.updatedAt && (now - cached.updatedAt < TTL_SEC * 1000)) {
      // serve warm, maybe refresh lazily
      kvRefreshIfStale(key, REVALIDATE_SEC).catch(()=>{})
      return res.status(200).json(cached.value)
    }

    // === compute in one pass ===
    const ohlc = await getYahooDailyOHLC(symbol, '1y') // { timestamps, closes, volumes } OR array of candles
    const closes: number[] = Array.isArray(ohlc)
      ? (ohlc as any[]).map(c => (typeof c?.close === 'number' ? c.close : null)).filter((n): n is number => Number.isFinite(n))
      : (Array.isArray((ohlc as any)?.closes) ? (ohlc as any).closes : [])

    const volumes: number[] = Array.isArray(ohlc)
      ? (ohlc as any[]).map(c => (typeof c?.volume === 'number' ? c.volume : null)).filter((n): n is number => Number.isFinite(n))
      : (Array.isArray((ohlc as any)?.volumes) ? (ohlc as any).volumes : [])

    if (closes.length < 60) {
      const resp: Resp = { symbol, score: null }
      await kvSetJSON(key, { updatedAt: now, value: resp }, TTL_SEC)
      return res.status(200).json(resp)
    }

    // indicators
    const ma = maCross(closes) // expects closes; returns { ma50, ma200, status?, points? }
    const rsi = rsi14(closes)  // returns { rsi, status?, points? } or number; support both
    const mac = macd(closes, 12, 26, 9) // returns { macd, signal, hist, status?, points? }
    const vol = vol20(volumes) // returns { period, volume?, avg20?, ratio, status?, points? }

    // normalize shapes
    const ma50 = (ma as any)?.ma50 ?? null
    const ma200 = (ma as any)?.ma200 ?? null
    const rsiValue = typeof (rsi as any)?.rsi === 'number' ? (rsi as any).rsi : (typeof rsi === 'number' ? rsi : null)
    const hist = (mac as any)?.hist ?? null
    const ratio = (vol as any)?.ratio ?? null

    // same weighting as on homepage
    const pMA   = toPtsSmart((ma as any)?.status,   (ma as any)?.points,   () => deriveMaPoints({ ma50, ma200 }))
    const pMACD = toPtsSmart((mac as any)?.status,  (mac as any)?.points,  () => deriveMacdPoints(hist, ma50))
    const pRSI  = toPtsSmart((rsi as any)?.status,  (rsi as any)?.points,  () => deriveRsiPoints(rsiValue))
    const pVOL  = toPtsSmart((vol as any)?.status,  (vol as any)?.points,  () => deriveVolPoints(ratio))

    const nMA   = (pMA   + 2) / 4
    const nMACD = (pMACD + 2) / 4
    const nRSI  = (pRSI  + 2) / 4
    const nVOL  = (pVOL  + 2) / 4

    const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
    const agg = W_MA*nMA + W_MACD*nMACD + W_RSI*nRSI + W_VOL*nVOL
    const score = clamp(Math.round(agg * 100), 0, 100)

    const resp: Resp = { symbol, score }
    await kvSetJSON(key, { updatedAt: now, value: resp }, TTL_SEC)
    return res.status(200).json(resp)
  } catch (e: any) {
    return res.status(200).json({ symbol: String(req.query.symbol || ''), score: null, error: String(e?.message || e) })
  }
}