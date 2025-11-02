// src/pages/api/market/home-snapshot.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { kvGetJSON, kvSetJSON } from '@/lib/kv'
import { cache5min } from '@/lib/cacheHeaders'
import { AEX } from '@/lib/aex'
import { SP500 } from '@/lib/sp500'
import { NASDAQ } from '@/lib/nasdaq'
import { DOWJONES } from '@/lib/dowjones'
import { DAX as DAX_FULL } from '@/lib/dax'
import { FTSE100 } from '@/lib/ftse100'
import { NIKKEI225 } from '@/lib/nikkei225'
import { HANGSENG } from '@/lib/hangseng'
import { SENSEX } from '@/lib/sensex'
import { getYahooDailyOHLC, type YahooRange } from '@/lib/providers/quote'

const RANGE: YahooRange = '1y'     // genoeg voor MA200 & MACD
const KV_TTL_SEC = 600             // 10m
const CONCURRENCY = 4              // defensief

type KVShape = {
  ma?: { ma50?: number|null; ma200?: number|null; status?: string }
  rsi?: { period?: number; rsi?: number|null; status?: string }
  macd?: { macd?: number|null; signal?: number|null; hist?: number|null; status?: string }
  volume?: { ratio?: number|null; status?: string }
  score?: { points?: number|null; status?: string }
}
type Snap = {
  symbol: string
  status: string | null
  score: number | null
  rsi: number | null
  macdHist: number | null
  maTrend: 'BUY'|'SELL'|'HOLD'|null
  updatedAt: number | null
}

function pickSymbols(market: string) {
  if (market === 'AEX') return AEX.map(x => x.symbol)
  if (market === 'SP500') return SP500.map((x:any)=>x.symbol)
  if (market === 'NASDAQ') return NASDAQ.map((x:any)=>x.symbol)
  if (market === 'DOWJONES') return DOWJONES.map((x:any)=>x.symbol)
  if (market === 'DAX') return DAX_FULL.map((x:any)=>x.symbol)
  if (market === 'FTSE100') return FTSE100.map((x:any)=>x.symbol)
  if (market === 'NIKKEI225') return NIKKEI225.map((x:any)=>x.symbol)
  if (market === 'HANGSENG') return HANGSENG.map((x:any)=>x.symbol)
  if (market === 'SENSEX') return SENSEX.map((x:any)=>x.symbol)
  return []
}

const closes = (o: any): number[] =>
  Array.isArray(o?.close) ? o.close.filter((n:any)=>typeof n==='number')
  : Array.isArray(o?.closes) ? o.closes.filter((n:any)=>typeof n==='number')
  : Array.isArray(o?.c) ? o.c.filter((n:any)=>typeof n==='number')
  : []

const sma = (xs: number[], p: number) => xs.length < p ? null : xs.slice(-p).reduce((a,b)=>a+b,0)/p

const rsiWilder = (cs: number[], period=14): number|null => {
  if (cs.length < period+1) return null
  let g=0,l=0; for (let i=1;i<=period;i++){const d=cs[i]-cs[i-1]; if(d>=0) g+=d; else l-=d}
  let ag=g/period, al=l/period
  for (let i=period+1;i<cs.length;i++){
    const d=cs[i]-cs[i-1]; const G=d>0?d:0, L=d<0?-d:0
    ag=(ag*(period-1)+G)/period; al=(al*(period-1)+L)/period
  }
  if (al===0) return 100
  const rs=ag/al; return 100-100/(1+rs)
}

const macdLast = (cs: number[], fast=12, slow=26, signal=9) => {
  if (cs.length < slow+signal) return { macd:null, signal:null, hist:null }
  const ema = (p:number) => { const k=2/(p+1); let e=cs[0]; return cs.map((x,i)=> i? e = x*k + e*(1-k) : e) }
  const emaF = ema(fast), emaS = ema(slow)
  const macd = emaF.map((x,i)=> x-(emaS[i]??x))
  const sig  = (()=>{ const k=2/(signal+1); let e=macd[slow]; return macd.map((x,i)=> i<slow? null : (e = i===slow? macd[slow] : x*k + e*(1-k))) })()
  const hist = macd.map((x,i)=> (sig[i]==null? null : x - (sig[i] as number)))
  const last = cs.length-1
  return { macd: macd[last] ?? null, signal: sig[last] ?? null, hist: hist[last] ?? null }
}

function mapFromKV(symbol: string, kv: {updatedAt?:number; value?:KVShape}|undefined): Snap|null {
  const v = kv?.value
  if (!v) return null
  const ma50 = v.ma?.ma50 ?? null
  const ma200 = v.ma?.ma200 ?? null
  const maTrend = (ma50!=null && ma200!=null) ? (ma50>ma200?'BUY':ma50<ma200?'SELL':'HOLD') : null
  return {
    symbol,
    status: v.score?.status ?? v.ma?.status ?? null,
    score: (typeof v.score?.points === 'number') ? v.score.points : null,
    rsi: (typeof v.rsi?.rsi === 'number') ? v.rsi.rsi : null,
    macdHist: (typeof v.macd?.hist === 'number') ? v.macd.hist : null,
    maTrend,
    updatedAt: kv?.updatedAt ?? null,
  }
}

async function computeAndWriteKV(symbol: string) {
  const o = await getYahooDailyOHLC(symbol, RANGE)
  const cs = closes(o)
  const ma50 = sma(cs,50), ma200 = sma(cs,200)
  const maStatus = (ma50!=null && ma200!=null) ? (ma50>ma200?'BUY':ma50<ma200?'SELL':'HOLD') : 'HOLD'
  const rsi = rsiWilder(cs,14)
  const m = macdLast(cs)
  const macdS = (m.hist==null)?'HOLD': (m.hist>0?'BUY':'SELL')
  const pts = [
    maStatus === 'BUY' ? 1 : maStatus === 'SELL' ? -1 : 0,
    rsi==null ? 0 : (rsi<30?1:rsi>70?-1:0),
    m.hist==null ? 0 : (m.hist>0?1:-1),
  ].reduce((a,b)=>a+b,0)

  const value: KVShape = {
    ma: { ma50, ma200, status: maStatus },
    rsi: { period:14, rsi, status: (rsi==null?'HOLD': rsi<30?'BUY': rsi>70?'SELL':'HOLD') },
    macd:{ macd:m.macd, signal:m.signal, hist:m.hist, status: macdS },
    score:{ points: pts, status: pts>0?'BUY': pts<0?'SELL':'HOLD' },
  }
  const key = `ind:snap:all:${symbol}`
  await kvSetJSON(key, { updatedAt: Date.now(), value }, KV_TTL_SEC)
  return mapFromKV(symbol, {updatedAt: Date.now(), value})
}

async function mapLimit<T,R>(arr:T[], limit:number, fn:(x:T, i:number)=>Promise<R>):Promise<R[]>{
  const out: R[] = new Array(arr.length)
  let i=0
  const workers = Array.from({length: Math.min(limit, arr.length)}, async () => {
    while (true) {
      const idx = i++
      if (idx >= arr.length) break
      out[idx] = await fn(arr[idx], idx)
      if (idx) await new Promise(r=>setTimeout(r,60))
    }
  })
  await Promise.all(workers)
  return out
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const raw = String(req.query.markets || 'AEX,SP500,NASDAQ,DOWJONES,DAX,FTSE100')
    const markets = [...new Set(raw.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean))]

    const result: Record<string, Snap[]> = {}
    let newest = 0

    // 1) KV-first
    for (const market of markets) {
      const symbols = pickSymbols(market).slice(0, 60)
      const snaps: (Snap|null)[] = await Promise.all(symbols.map(async (sym) => {
        const key = `ind:snap:all:${sym}`
        const kv = await kvGetJSON<{updatedAt?:number; value?:KVShape}>(key).catch(()=>undefined)
        const mapped = mapFromKV(sym, kv)
        if (mapped?.updatedAt && mapped.updatedAt > newest) newest = mapped.updatedAt
        return mapped
      }))
      result[market] = snaps.filter(Boolean) as Snap[]
    }

    // 2) Asynchrone best-effort backfill van misses -> KV warm maken
    ;(async () => {
      for (const market of markets) {
        const have = new Set(result[market].map(x=>x.symbol))
        const symbols = pickSymbols(market).slice(0, 60).filter(s => !have.has(s))
        if (!symbols.length) continue
        try { await mapLimit(symbols, CONCURRENCY, computeAndWriteKV) } catch {}
      }
    })().catch(()=>{})

    // CDN/browser caching → goedkoop & snel
    cache5min(res, /*s-maxage=*/30, /*SWR=*/1800)
    const etag = `W/"home-${newest}"`
    res.setHeader('ETag', etag)
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end()
    }

    return res.status(200).json({ markets, updatedAt: newest || Date.now(), items: result })
  } catch (e:any) {
    return res.status(500).json({ error: String(e?.message||e) })
  }
}