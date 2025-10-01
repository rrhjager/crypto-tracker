import type { NextApiRequest, NextApiResponse } from 'next'
import { AEX } from '@/lib/aex'
import { SP500 } from '@/lib/sp500'
// importeer ook NASDAQ, DAX etc. (zoals je libs hebt)

type Advice = 'BUY' | 'HOLD' | 'SELL'
type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'

function statusFromScore(score: number): Advice {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const MARKETS: Record<MarketLabel, {symbol:string;name:string}[]> = {
    AEX, 'S&P 500': SP500, NASDAQ: [], 'Dow Jones': [],
    DAX: [], 'FTSE 100': [], 'Nikkei 225': [], 'Hang Seng': [], 'Sensex': []
  }

  async function calcScore(sym: string) {
    const [rMa, rRsi, rMacd, rVol] = await Promise.all([
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/indicators/ma-cross/${sym}`).then(r=>r.json()),
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/indicators/rsi/${sym}?period=14`).then(r=>r.json()),
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/indicators/macd/${sym}?fast=12&slow=26&signal=9`).then(r=>r.json()),
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/indicators/vol20/${sym}?period=20`).then(r=>r.json()),
    ])

    const clamp = (n:number,a:number,b:number)=>Math.max(a,Math.min(b,n))
    const toPts = (status?: Advice, pts?: number | null) => {
      if (Number.isFinite(pts as number)) return clamp(Number(pts), -2, 2)
      if (status === 'BUY') return 2
      if (status === 'SELL') return -2
      return 0
    }
    const W_MA=0.40,W_MACD=0.30,W_RSI=0.20,W_VOL=0.10
    const pMA   = toPts(rMa?.status,   rMa?.points)
    const pMACD = toPts(rMacd?.status, rMacd?.points)
    const pRSI  = toPts(rRsi?.status,  rRsi?.points)
    const pVOL  = toPts(rVol?.status,  rVol?.points)

    const nMA=(pMA+2)/4, nMACD=(pMACD+2)/4, nRSI=(pRSI+2)/4, nVOL=(pVOL+2)/4
    const agg = W_MA*nMA + W_MACD*nMACD + W_RSI*nRSI + W_VOL*nVOL
    return Math.round(agg*100)
  }

  const result:any[]=[]
  for (const [market, list] of Object.entries(MARKETS)) {
    const scores = await Promise.all(list.map(async a=>{
      const score = await calcScore(a.symbol)
      return { ...a, score, market, signal: statusFromScore(score) }
    }))
    const valid = scores.filter(x=>Number.isFinite(x.score))
    if (valid.length>0){
      const topBuy = [...valid].sort((a,b)=>b.score-a.score)[0]
      const topSell = [...valid].sort((a,b)=>a.score-b.score)[0]
      result.push({market, topBuy, topSell})
    }
  }

  res.status(200).json({markets: result})
}