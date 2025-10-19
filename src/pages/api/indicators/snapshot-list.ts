// src/pages/api/indicators/snapshot-list.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getYahooDailyOHLC, type YahooRange } from '@/lib/providers/quote'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'

import { AEX } from '@/lib/aex'
import { SP500 } from '@/lib/sp500'
import { NASDAQ } from '@/lib/nasdaq'
import { DOWJONES } from '@/lib/dowjones'
import { DAX as DAX_FULL } from '@/lib/dax'
import { FTSE100 } from '@/lib/ftse100'
import { NIKKEI225 } from '@/lib/nikkei225'
import { HANGSENG } from '@/lib/hangseng'
import { SENSEX } from '@/lib/sensex'

type Advice = 'BUY'|'HOLD'|'SELL'
type SnapItem = {
  symbol: string
  ma:    { ma50: number|null; ma200: number|null; status: Advice }
  rsi:   { period: number; rsi: number|null; status: Advice }
  macd:  { macd: number|null; signal: number|null; hist: number|null; status: Advice }
  volume:{ volume: number|null; avg20d: number|null; ratio: number|null; status: Advice }
  score: number
}
type Resp = { items: SnapItem[]; updatedAt: number }

export const config = { runtime: 'nodejs' }

// Edge cache
const EDGE_MAX_AGE = 30               // seconden
// KV policy: serve cached, revalidate in bg als bijna op
const KV_TTL_SEC = 600                // 10 minuten houdbaar per symbool
const KV_REVALIDATE_SEC = 120         // binnen 2 min voor TTL-einde: bg refresh
const RANGE: YahooRange = '1y'

/* ---------- helpers ---------- */
type Bar = { close?: number; c?: number; volume?: number; v?: number; t?: number }
const closes = (arr: any): number[] =>
  (Array.isArray(arr) ? (arr as Bar[]).map(b => (typeof b.close==='number'?b.close:typeof b.c==='number'?b.c:null)).filter(Number.isFinite)
   : Array.isArray(arr?.closes) ? (arr.closes as number[]).filter(Number.isFinite)
   : Array.isArray(arr?.c) ? (arr.c as number[]).filter(Number.isFinite) : [])

const volumes = (arr: any): number[] =>
  (Array.isArray(arr) ? (arr as Bar[]).map(b => (typeof b.volume==='number'?b.volume:typeof b.v==='number'?b.v:null)).filter(Number.isFinite)
   : Array.isArray(arr?.volumes) ? (arr.volumes as number[]).filter(Number.isFinite)
   : Array.isArray(arr?.v) ? (arr.v as number[]).filter(Number.isFinite) : [])

const sma = (xs: number[], p: number) => xs.length < p ? null : xs.slice(-p).reduce((a,b)=>a+b,0)/p
const rsiWilder = (cs: number[], period=14): number|null => {
  if (cs.length < period+1) return null
  let g=0,l=0; for (let i=1;i<=period;i++){const d=cs[i]-cs[i-1]; if(d>=0) g+=d; else l-=d}
  let ag=g/period, al=l/period
  for (let i=period+1;i<cs.length;i++){const d=cs[i]-cs[i-1]; const G=d>0?d:0, L=d<0?-d:0; ag=(ag*(period-1)+G)/period; al=(al*(period-1)+L)/period}
  if (al===0) return 100
  const rs=ag/al; return 100-100/(1+rs)
}
const macdLast = (cs: number[], fast=12, slow=26, signal=9) => {
  if (cs.length < slow + signal) return { macd:null, signal:null, hist:null }
  const ema = (p:number)=>{const k=2/(p+1); let e=cs.slice(0,p).reduce((a,b)=>a+b,0)/p; for(let i=p;i<cs.length;i++) e=cs[i]*k+e*(1-k); return e}
  const m = ema(fast) - ema(slow)
  const k = 2/(signal+1); let sig = m; for(let i=0;i<signal;i++) sig = m*k + sig*(1-k)
  return { macd:m, signal:sig, hist:m-sig }
}
const adv = (v:number|null, lo:number, hi:number): Advice => v==null?'HOLD':(v<lo?'SELL':v>hi?'BUY':'HOLD')
const scoreFrom = (ma:Advice, macd:Advice, rsi:Advice, vol:Advice) => {
  const pts = (s:Advice)=> s==='BUY'?2:s==='SELL'?-2:0
  const n = (p:number)=> (p+2)/4
  const W_MA=.40, W_MACD=.30, W_RSI=.20, W_VOL=.10
  const agg = W_MA*n(pts(ma)) + W_MACD*n(pts(macd)) + W_RSI*n(pts(rsi)) + W_VOL*n(pts(vol))
  return Math.round(Math.max(0, Math.min(1, agg)) * 100)
}

// Markt → symbolen
const STATIC_CONS = {
  AEX, 'S&P 500': SP500, NASDAQ, 'Dow Jones': DOWJONES, DAX: DAX_FULL,
  'FTSE 100': FTSE100, 'Nikkei 225': NIKKEI225, 'Hang Seng': HANGSENG, Sensex: SENSEX,
} as const
const listForMarket = (mkt?: string) => {
  if (!mkt) return [] as Array<{symbol:string; name:string}>
  const arr = (STATIC_CONS as any)[mkt] || []
  return arr.map((x:any)=>({symbol:x.symbol, name:x.name}))
}

/* ---------- per-symbool compute + KV ---------- */
async function computeOne(symbol: string): Promise<SnapItem> {
  const o = await getYahooDailyOHLC(symbol, RANGE)
  const cs = closes(o), vs = volumes(o)
  const ma50 = sma(cs,50), ma200 = sma(cs,200)
  const maS  = (ma50!=null && ma200!=null) ? (ma50>ma200?'BUY':ma50<ma200?'SELL':'HOLD') : 'HOLD'
  const rsi  = rsiWilder(cs,14); const rsiS = adv(rsi,30,70)
  const m    = macdLast(cs,12,26,9); const macdS = (m.macd!=null && m.signal!=null) ? (m.macd>m.signal?'BUY':m.macd<m.signal?'SELL':'HOLD'):'HOLD'
  const vol  = vs.length?vs.at(-1)!:null
  const avg20 = vs.slice(-20).length===20 ? vs.slice(-20).reduce((a,b)=>a+b,0)/20 : null
  const ratio = (vol!=null && avg20!=null && avg20>0) ? vol/avg20 : null
  const volS  = ratio==null ? 'HOLD' : (ratio>1.3?'BUY':ratio<0.7?'SELL':'HOLD')
  const score = scoreFrom(maS, macdS, rsiS, volS)
  return { symbol,
    ma:{ma50:ma50??null, ma200:ma200??null, status:maS},
    rsi:{period:14, rsi:rsi??null, status:rsiS},
    macd:{macd:m.macd??null, signal:m.signal??null, hist:m.hist??null, status:macdS},
    volume:{volume:vol??null, avg20d:avg20??null, ratio:ratio??null, status:volS},
    score
  }
}

/* ---------- handler ---------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp|{error:string}>) {
  // Edge cache (CDN)
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_MAX_AGE}, stale-while-revalidate=300`)

  try {
    const rawSyms = String(req.query.symbols||'').trim()
    const market  = String(req.query.market||'').trim()
    let symbols: string[] = []

    if (rawSyms) {
      symbols = rawSyms.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    } else if (market) {
      symbols = listForMarket(market).map(x => x.symbol.toUpperCase())
    } else {
      return res.status(400).json({ error: 'Provide ?symbols=A,B or ?market=AEX|DAX|...' })
    }

    // Beperk concurrency zodat memory laag blijft
    const N = Math.min(6, Math.max(1, Math.floor(24 / Math.max(1, symbols.length)))) // defensief

    const items: SnapItem[] = []
    let i = 0
    await Promise.all(new Array(Math.min(N, symbols.length)).fill(0).map(async () => {
      while (true) {
        const idx = i++
        if (idx >= symbols.length) break
        const sym = symbols[idx]

        // Serve cached; revalidate in bg vlak voor TTL-einde
        const key = `snap:${sym}`
        const cached = await kvRefreshIfStale<SnapItem>(key, KV_TTL_SEC, KV_REVALIDATE_SEC, () => computeOne(sym))
        if (cached) {
          items.push(cached)
        } else {
          // als KV uitvalt: bereken sync en zet in KV
          const fresh = await computeOne(sym)
          items.push(fresh)
          try { await kvSetJSON(key, fresh, KV_TTL_SEC) } catch {}
        }
      }
    }))

    return res.status(200).json({ items, updatedAt: Date.now() })
  } catch (e:any) {
    return res.status(500).json({ error: String(e?.message||e) })
  }
}