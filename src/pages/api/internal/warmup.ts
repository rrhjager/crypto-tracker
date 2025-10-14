// src/pages/api/internal/warmup.ts
export const config = { runtime: 'nodejs', maxDuration: 60 }

import type { NextApiRequest, NextApiResponse } from 'next'

// Zelfde universa als je homepage gebruikt
const MARKETS: Record<string, string[]> = {
  'S&P 500': ['AAPL','MSFT','NVDA','AMZN','META'],
  'NASDAQ':  ['TSLA','GOOGL','ADBE','AVGO','AMD'],
  'Dow':     ['MRK','PG','V','JPM','UNH'],
  'DAX':     ['SAP.DE','SIE.DE','BMW.DE','BAS.DE','MBG.DE'],
  'FTSE':    ['AZN.L','SHEL.L','HSBA.L','ULVR.L','BATS.L'],
  'Nikkei':  ['7203.T','6758.T','9984.T','8035.T','4063.T'],
  'HangSeng':['0700.HK','0939.HK','2318.HK','1299.HK','0005.HK'],
  'Sensex':  ['RELIANCE.NS','TCS.NS','HDFCBANK.NS','INFY.NS','ICICIBANK.NS'],
}

// Top coins (zelfde set als je crypto UI gebruikt)
const COINS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','TONUSDT','TRXUSDT','AVAXUSDT',
  'DOTUSDT','LINKUSDT','LTCUSDT','BCHUSDT','NEARUSDT','ATOMUSDT','ETCUSDT','IMXUSDT','RUNEUSDT','AAVEUSDT',
]

async function hit(path: string) {
  try {
    const r = await fetch(path, { cache: 'no-store' })
    return r.ok
  } catch { return false }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `http://localhost:${process.env.PORT || 3000}`

  const urls: string[] = []

  // 1) Equities indicators (MA/RSI/MACD/Vol20) – vult KV per sym
  const eqSyms = Object.values(MARKETS).flat()
  for (const s of eqSyms) {
    urls.push(
      `${base}/api/indicators/ma-cross/${encodeURIComponent(s)}`,
      `${base}/api/indicators/rsi/${encodeURIComponent(s)}?period=14`,
      `${base}/api/indicators/macd/${encodeURIComponent(s)}?fast=12&slow=26&signal=9`,
      `${base}/api/indicators/vol20/${encodeURIComponent(s)}?period=20`
    )
  }

  // 2) Crypto indicators (lichtgewicht) + prices batches
  //   - indicators is per sym
  for (const c of COINS) {
    urls.push(`${base}/api/crypto-light/indicators?symbols=${encodeURIComponent(c)}`)
  }
  //   - prices in batches
  const batch = (arr: string[], n: number) => {
    for (let i=0;i<arr.length;i+=n) urls.push(`${base}/api/crypto-light/prices?symbols=${arr.slice(i,i+n).join(',')}`)
  }
  batch(COINS, 25)

  // 3) News (twee topics)
  urls.push(
    `${base}/api/news/google?q=${encodeURIComponent('crypto OR bitcoin OR ethereum OR blockchain')}`,
    `${base}/api/news/google?q=${encodeURIComponent('equities OR stocks OR stock market OR aandelen OR beurs')}`
  )

  // 4) Sectors, Congress, Macro
  urls.push(
    `${base}/api/market/sectors`,
    `${base}/api/market/congress?limit=30`,
    `${base}/api/market/macro?days=120`
  )

  // Fire in pools om gratis tier niet te overbelasten
  const CONC = 6
  let i = 0, ok = 0
  await Promise.all(
    Array.from({ length: CONC }).map(async () => {
      while (i < urls.length) {
        const idx = i++
        const success = await hit(urls[idx])
        if (success) ok++
        await new Promise(r => setTimeout(r, 120)) // klein pauzetje
      }
    })
  )

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ ok, total: urls.length, hint: 'KV warmed (best effort)' })
}