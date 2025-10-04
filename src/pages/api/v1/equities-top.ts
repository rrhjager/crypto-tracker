// src/pages/api/v1/equities-top.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { AEX } from '@/lib/aex'

type Advice = 'BUY'|'HOLD'|'SELL'
type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'

type MaCrossResp = { symbol: string; ma50: number | null; ma200: number | null; status?: Advice | string; points?: number | string | null }
type RsiResp    = { symbol: string; period: number; rsi: number | null; status?: Advice | string; points?: number | string | null }
type MacdResp   = { symbol: string; fast: number; slow: number; signalPeriod: number; macd: number | null; signal: number | null; hist: number | null; status?: Advice | string; points?: number | string | null }
type Vol20Resp  = { symbol: string; period: number; volume: number | null; avg20: number | null; ratio: number | null; status?: Advice | string; points?: number | string | null }

const clamp = (n:number,a:number,b:number)=>Math.max(a,Math.min(b,n))
const toNum = (x: unknown) => (typeof x === 'string' ? Number(x) : (x as number))
const isFiniteNum = (x: unknown) => Number.isFinite(toNum(x))
const scoreToPts = (s: number) => clamp((s / 100) * 4 - 2, -2, 2)

function deriveMaPoints(ma?: MaCrossResp): number | null {
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
function deriveRsiPoints(rsiResp?: RsiResp): number | null {
  const r = rsiResp?.rsi
  if (typeof r !== 'number') return null
  const rsiScore = clamp(((r - 30) / 40) * 100, 0, 100)
  return scoreToPts(rsiScore)
}
function deriveMacdPoints(macd?: MacdResp, ma?: MaCrossResp): number | null {
  const hist = macd?.hist
  const ma50 = ma?.ma50 ?? null
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
function deriveVolPoints(vol?: Vol20Resp): number | null {
  const ratio = vol?.ratio
  if (typeof ratio !== 'number') return null
  const delta = clamp((ratio - 1) / 1, -1, 1)
  const volScore = clamp(50 + delta * 30, 0, 100)
  return scoreToPts(volScore)
}
const toPtsSmart = (
  status?: Advice | string,
  pts?: number | string | null,
  fallback: () => number | null = () => null
) => {
  if (isFiniteNum(pts)) return clamp(toNum(pts), -2, 2)
  const s = String(status || '').toUpperCase()
  if (s === 'BUY')  return  2
  if (s === 'SELL') return -2
  const f = fallback()
  return f == null ? 0 : clamp(f, -2, 2)
}

const STATIC_CONS: Record<MarketLabel, { symbol: string; name: string }[]> = {
  'AEX': [], // dynamisch uit lib/aex hieronder
  'S&P 500': [
    { symbol: 'AAPL',  name: 'Apple' },
    { symbol: 'MSFT',  name: 'Microsoft' },
    { symbol: 'NVDA',  name: 'NVIDIA' },
    { symbol: 'AMZN',  name: 'Amazon' },
    { symbol: 'META',  name: 'Meta Platforms' },
  ],
  'NASDAQ': [
    { symbol: 'TSLA',  name: 'Tesla' },
    { symbol: 'GOOGL', name: 'Alphabet' },
    { symbol: 'ADBE',  name: 'Adobe' },
    { symbol: 'AVGO',  name: 'Broadcom' },
    { symbol: 'AMD',   name: 'Advanced Micro Devices' },
  ],
  'Dow Jones': [
    { symbol: 'MRK', name: 'Merck' },
    { symbol: 'PG',  name: 'Procter & Gamble' },
    { symbol: 'V',   name: 'Visa' },
    { symbol: 'JPM', name: 'JPMorgan Chase' },
    { symbol: 'UNH', name: 'UnitedHealth' },
  ],
  'DAX': [
    { symbol: 'SAP.DE',  name: 'SAP' },
    { symbol: 'SIE.DE',  name: 'Siemens' },
    { symbol: 'BMW.DE',  name: 'BMW' },
    { symbol: 'BAS.DE',  name: 'BASF' },
    { symbol: 'MBG.DE',  name: 'Mercedes-Benz Group' },
  ],
  'FTSE 100': [
    { symbol: 'AZN.L',   name: 'AstraZeneca' },
    { symbol: 'SHEL.L',  name: 'Shell' },
    { symbol: 'HSBA.L',  name: 'HSBC' },
    { symbol: 'ULVR.L',  name: 'Unilever' },
    { symbol: 'BATS.L',  name: 'BAT' },
  ],
  'Nikkei 225': [
    { symbol: '7203.T',  name: 'Toyota' },
    { symbol: '6758.T',  name: 'Sony' },
    { symbol: '9984.T',  name: 'SoftBank Group' },
    { symbol: '8035.T',  name: 'Tokyo Electron' },
    { symbol: '4063.T',  name: 'Shin-Etsu Chemical' },
  ],
  'Hang Seng': [
    { symbol: '0700.HK', name: 'Tencent' },
    { symbol: '0939.HK', name: 'China Construction Bank' },
    { symbol: '2318.HK', name: 'Ping An' },
    { symbol: '1299.HK', name: 'AIA Group' },
    { symbol: '0005.HK', name: 'HSBC Holdings' },
  ],
  'Sensex': [
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries' },
    { symbol: 'TCS.NS',      name: 'TCS' },
    { symbol: 'HDFCBANK.NS', name: 'HDFC Bank' },
    { symbol: 'INFY.NS',     name: 'Infosys' },
    { symbol: 'ICICIBANK.NS',name: 'ICICI Bank' },
  ],
}

function constituentsForMarket(label: MarketLabel) {
  if (label === 'AEX') return AEX.map(x => ({ symbol: x.symbol, name: x.name }))
  return STATIC_CONS[label] || []
}

function baseUrl(req: NextApiRequest) {
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const proto = (req.headers['x-forwarded-proto'] as string) || 'http'
  return `${proto}://${host}`
}

async function calcScoreForSymbol(absBase: string, symbol: string): Promise<number | null> {
  try {
    const [rMa, rRsi, rMacd, rVol] = await Promise.all([
      fetch(`${absBase}/api/indicators/ma-cross/${encodeURIComponent(symbol)}`, { cache: 'no-store' }),
      fetch(`${absBase}/api/indicators/rsi/${encodeURIComponent(symbol)}?period=14`, { cache: 'no-store' }),
      fetch(`${absBase}/api/indicators/macd/${encodeURIComponent(symbol)}?fast=12&slow=26&signal=9`, { cache: 'no-store' }),
      fetch(`${absBase}/api/indicators/vol20/${encodeURIComponent(symbol)}?period=20`, { cache: 'no-store' }),
    ])
    if (!(rMa.ok && rRsi.ok && rMacd.ok && rVol.ok)) return null

    const [ma, rsi, macd, vol] = await Promise.all([
      rMa.json(), rRsi.json(), rMacd.json(), rVol.json()
    ]) as [MaCrossResp, RsiResp, MacdResp, Vol20Resp]

    const pMA   = toPtsSmart(ma?.status,   ma?.points,   () => deriveMaPoints(ma))
    const pMACD = toPtsSmart(macd?.status, macd?.points, () => deriveMacdPoints(macd, ma))
    const pRSI  = toPtsSmart(rsi?.status,  rsi?.points,  () => deriveRsiPoints(rsi))
    const pVOL  = toPtsSmart(vol?.status,  vol?.points,  () => deriveVolPoints(vol))

    const nMA   = (pMA   + 2) / 4
    const nMACD = (pMACD + 2) / 4
    const nRSI  = (pRSI  + 2) / 4
    const nVOL  = (pVOL  + 2) / 4

    const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
    const agg = W_MA*nMA + W_MACD*nMACD + W_RSI*nRSI + W_VOL*nVOL
    return clamp(Math.round(agg * 100), 0, 100)
  } catch {
    return null
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const abs = baseUrl(req)
    const MARKET_ORDER: MarketLabel[] = ['AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex']

    const topBuy: Array<{symbol:string;name:string;market:MarketLabel;score:number}> = []
    const topSell: Array<{symbol:string;name:string;market:MarketLabel;score:number}> = []

    for (const market of MARKET_ORDER) {
      const cons = constituentsForMarket(market)
      if (!cons.length) continue

      // throttle a bit
      const scores: Array<number|null> = []
      for (let i=0;i<cons.length;i++) {
        // kleine delay om provider te ontzien
        if (i) await new Promise(r => setTimeout(r, 60))
        scores.push(await calcScoreForSymbol(abs, cons[i].symbol))
      }

      const rows = cons.map((c,i)=>({ ...c, market, score: scores[i] ?? (null as any) }))
        .filter(r => Number.isFinite(r.score as number)) as Array<{symbol:string;name:string;market:MarketLabel;score:number}>

      if (rows.length) {
        const best = [...rows].sort((a,b)=> b.score - a.score)[0]
        const worst = [...rows].sort((a,b)=> a.score - b.score)[0]
        if (best) topBuy.push(best)
        if (worst) topSell.push(worst)
      }
    }

    res.status(200).json({ topBuy, topSell, ts: Date.now() })
  } catch (e:any) {
    res.status(500).json({ error: String(e?.message || e) })
  }
}