// src/pages/api/warm-cache.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { cache5min } from '@/lib/cacheHeaders'

type MarketLabel =
  | 'AEX' | 'S&P 500' | 'NASDAQ' | 'Dow Jones'
  | 'DAX' | 'FTSE 100' | 'Nikkei 225' | 'Hang Seng' | 'Sensex'

// ——— dezelfde lijsten als in je homepage ——— //
const STATIC_CONS: Record<MarketLabel, { symbol: string; name: string }[]> = {
  'AEX': [], // AEX komt uit je lib
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

const COINS: { symbol: string; name: string }[] = [
  { symbol: 'BTC-USD',  name: 'Bitcoin' },
  { symbol: 'ETH-USD',  name: 'Ethereum' },
  { symbol: 'BNB-USD',  name: 'BNB' },
  { symbol: 'SOL-USD',  name: 'Solana' },
  { symbol: 'XRP-USD',  name: 'XRP' },
  { symbol: 'ADA-USD',  name: 'Cardano' },
  { symbol: 'DOGE-USD', name: 'Dogecoin' },
  { symbol: 'TON-USD',  name: 'Toncoin' },
  { symbol: 'TRX-USD',  name: 'TRON' },
  { symbol: 'AVAX-USD', name: 'Avalanche' },
  { symbol: 'DOT-USD',  name: 'Polkadot' },
  { symbol: 'LINK-USD', name: 'Chainlink' },
  { symbol: 'BCH-USD',  name: 'Bitcoin Cash' },
  { symbol: 'LTC-USD',  name: 'Litecoin' },
  { symbol: 'MATIC-USD', name: 'Polygon' },
  { symbol: 'XLM-USD',  name: 'Stellar' },
  { symbol: 'NEAR-USD', name: 'NEAR' },
  { symbol: 'ICP-USD',  name: 'Internet Computer' },
  { symbol: 'ETC-USD',  name: 'Ethereum Classic' },
  { symbol: 'FIL-USD',  name: 'Filecoin' },
  { symbol: 'XMR-USD',  name: 'Monero' },
  { symbol: 'APT-USD',  name: 'Aptos' },
  { symbol: 'ARB-USD',  name: 'Arbitrum' },
  { symbol: 'OP-USD',   name: 'Optimism' },
  { symbol: 'SUI-USD',  name: 'Sui' },
  { symbol: 'HBAR-USD', name: 'Hedera' },
  { symbol: 'ALGO-USD', name: 'Algorand' },
  { symbol: 'VET-USD',  name: 'VeChain' },
  { symbol: 'EGLD-USD', name: 'MultiversX' },
  { symbol: 'AAVE-USD', name: 'Aave' },
  { symbol: 'INJ-USD',  name: 'Injective' },
  { symbol: 'MKR-USD',  name: 'Maker' },
  { symbol: 'RUNE-USD', name: 'THORChain' },
  { symbol: 'IMX-USD',  name: 'Immutable' },
  { symbol: 'FLOW-USD', name: 'Flow' },
  { symbol: 'SAND-USD', name: 'The Sandbox' },
  { symbol: 'MANA-USD', name: 'Decentraland' },
  { symbol: 'AXS-USD',  name: 'Axie Infinity' },
  { symbol: 'QNT-USD',  name: 'Quant' },
  { symbol: 'GRT-USD',  name: 'The Graph' },
  { symbol: 'CHZ-USD',  name: 'Chiliz' },
  { symbol: 'CRV-USD',  name: 'Curve DAO' },
  { symbol: 'ENJ-USD',  name: 'Enjin Coin' },
  { symbol: 'FTM-USD',  name: 'Fantom' },
  { symbol: 'XTZ-USD',  name: 'Tezos' },
  { symbol: 'LDO-USD',  name: 'Lido DAO' },
  { symbol: 'SNX-USD',  name: 'Synthetix' },
  { symbol: 'STX-USD',  name: 'Stacks' },
  { symbol: 'AR-USD',   name: 'Arweave' },
  { symbol: 'GMX-USD',  name: 'GMX' },
]

const MARKET_ORDER: MarketLabel[] = [
  'AEX','S&P 500','NASDAQ','Dow Jones','DAX','FTSE 100','Nikkei 225','Hang Seng','Sensex'
]

// kleine helpers
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const toBinancePair = (symbol: string) => {
  const s = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const skip = new Set(['USDT','USDC','BUSD','DAI','TUSD'])
  if (!s || skip.has(s)) return null
  return `${s}USDT`
}

async function warm(url: string) {
  // Belangrijk: laat CDN cacheen als de endpoint cache headers zet
  // (zie cache5min in de betrokken API-routes)
  return fetch(url, { method: 'GET' }).then(r => r.ok ? r : Promise.reject(r))
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Zorg dat deze route zelf ook cache headers heeft (zodat je hem snel kunt inspecteren)
  cache5min(res, 60, 30)

  const startedAt = Date.now()
  const results: { ok: string[]; fail: string[] } = { ok: [], fail: [] }

  // 1) NEWS (2 feeds)
  const locale = 'hl=en-US&gl=US&ceid=US:en'
  const newsTargets = [
    `/api/news/google?q=crypto&${locale}`,
    `/api/news/google?q=equities&${locale}`,
  ]

  // 2) CRYPTO indicators (alle coins)
  const coinPairs = COINS.map(c => {
    const base = c.symbol.replace('-USD','')
    return toBinancePair(base) || toBinancePair(c.symbol)
  }).filter(Boolean) as string[]

  const cryptoTargets = coinPairs.map(p =>
    `/api/crypto-light/indicators?symbols=${encodeURIComponent(p)}`
  )

  // 3) EQUITIES indicators per markt (subset van tickers voor “top buy/sell” logica)
  //   We warmen de 4 indicator endpoints voor elk symbool.
  const equitySymbols: string[] = []
  for (const m of MARKET_ORDER) {
    const set = STATIC_CONS[m] || []
    set.forEach(s => equitySymbols.push(s.symbol))
  }

  const eqTargets: string[] = []
  for (const sym of equitySymbols) {
    const e = encodeURIComponent(sym)
    eqTargets.push(`/api/indicators/ma-cross/${e}`)
    eqTargets.push(`/api/indicators/rsi/${e}?period=14`)
    eqTargets.push(`/api/indicators/macd/${e}?fast=12&slow=26&signal=9`)
    eqTargets.push(`/api/indicators/vol20/${e}?period=20`)
  }

  // 4) Eventueel prijzen (crypto mini)
  const priceTargets = coinPairs.map(p =>
    `/api/crypto-light/prices?symbols=${encodeURIComponent(p)}`
  )

  const allTargets = [
    ...newsTargets,
    ...cryptoTargets,
    ...eqTargets,
    ...priceTargets,
  ]

  // Parallel, maar met beheersing (concurrency) en mini pauzes
  const CONCURRENCY = 10
  let idx = 0
  async function worker() {
    while (idx < allTargets.length) {
      const i = idx++
      const path = allTargets[i]
      try {
        // Kleinere delay om bursts te flatten
        if (i % 8 === 0) await sleep(50)
        await warm(path)
        results.ok.push(path)
      } catch {
        results.fail.push(path)
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, allTargets.length) }, () => worker())
  await Promise.all(workers)

  res.status(200).json({
    ok: results.ok.length,
    fail: results.fail.length,
    took_ms: Date.now() - startedAt,
    sample_fail: results.fail.slice(0, 5),
  })
}

export const config = {
  api: {
    bodyParser: false,
  },
}