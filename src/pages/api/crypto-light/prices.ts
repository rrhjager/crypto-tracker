// bovenaan
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'

// Zelfde alias-set als indicators (inkorten kan, maar sync houden is handig)
const CG_ALIASES: Record<string, string[]> = {
  BTCUSDT: ['bitcoin'], ETHUSDT: ['ethereum'], BNBUSDT: ['binancecoin'],
  SOLUSDT: ['solana'], XRPUSDT: ['ripple'], ADAUSDT: ['cardano'],
  DOGEUSDT: ['dogecoin'], TRXUSDT: ['tron'],
  TONUSDT: ['toncoin', 'the-open-network'],
  AVAXUSDT: ['avalanche-2'], MATICUSDT: ['matic-network'], DOTUSDT: ['polkadot'],
  LTCUSDT: ['litecoin'], BCHUSDT: ['bitcoin-cash'], LINKUSDT: ['chainlink'],
  XLMUSDT: ['stellar'], NEARUSDT: ['near'], ATOMUSDT: ['cosmos'],
  ETCUSDT: ['ethereum-classic'], XMRUSDT: ['monero'], UNIUSDT: ['uniswap'],
  ICPUSDT: ['internet-computer'], APTUSDT: ['aptos'], ARBUSDT: ['arbitrum'],
  OPUSDT: ['optimism'], FILUSDT: ['filecoin'], VETUSDT: ['vechain'],
  AAVEUSDT: ['aave'], MKRUSDT: ['maker'], SUIUSDT: ['sui'],
  RNDRUSDT: ['render-token'], IMXUSDT: ['immutable-x'], INJUSDT: ['injective-protocol'],
  ALGOUSDT: ['algorand'], QNTUSDT: ['quant-network'], THETAUSDT: ['theta-token'],
  GRTUSDT: ['the-graph'], FLOWUSDT: ['flow'], CHZUSDT: ['chiliz'],
  MANAUSDT: ['decentraland'], SANDUSDT: ['the-sandbox'], AXSUSDT: ['axie-infinity'],
  DYDXUSDT: ['dydx'], STXUSDT: ['stacks'], KASUSDT: ['kaspa'],
  SEIUSDT: ['sei-network'], PEPEUSDT: ['pepe'], BONKUSDT: ['bonk'],
  JASMYUSDT: ['jasmycoin'], FTMUSDT: ['fantom'], SHIBUSDT: ['shiba-inu'],
}

type SimplePriceResp = Record<string, {
  usd?: number
  usd_24h_change?: number
  usd_7d_change?: number
  usd_30d_change?: number
}>

async function fetchSimplePrice(ids: string[]) {
  if (ids.length === 0) return {}
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_30d_change=true`
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) return {}
  return (await r.json()) as SimplePriceResp
}

// Fallback: bereken price + d/w/m uit market_chart (laatste close)
type MarketChart = { prices: [number, number][] }
async function fetchMarketChartPrice(id: string) {
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=200&interval=daily`,
    { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) throw new Error(`CG ${id} HTTP ${r.status}`)
  const j = (await r.json()) as MarketChart
  const closes = (j.prices || []).map(p => Number(p[1])).filter(Number.isFinite)
  const last = closes.at(-1) ?? null
  const pct = (nAgo: number) => {
    const ref = closes.at(-(nAgo + 1))
    if (!last || !ref) return null
    return ((last - ref) / ref) * 100
  }
  return { price: last, d: pct(1), w: pct(7), m: pct(30) }
}

async function searchCG(query: string): Promise<string[]> {
  const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) return []
  const j = await r.json()
  const coins: any[] = j?.coins || []
  return coins.slice(0, 5).map(c => String(c.id))
}
const baseSymbolFromBinance = (s: string) => s.replace(/(USDT|USDC|BUSD|TUSD|DAI)$/i, '')

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbolsParam = String(req.query.symbols || '').trim()
    if (!symbolsParam) return res.status(400).json({ error: 'Missing ?symbols=BTCUSDT,ETHUSDT' })
    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)

    // 1) probeer simple/price in 1 batch
    const uniqueIds = Array.from(new Set(symbols.flatMap(s => CG_ALIASES[s] || [])))
    const simple = await fetchSimplePrice(uniqueIds)

    const results = await Promise.all(symbols.map(async (sym) => {
      // pak eerste alias die in simple/price zat
      const aliases = CG_ALIASES[sym] || []
      let data: any = null
      for (const id of aliases) {
        if (simple[id]) { data = simple[id]; break }
      }

      if (data) {
        return {
          symbol: sym,
          price: data.usd ?? null,
          d: data.usd_24h_change ?? null,
          w: data.usd_7d_change ?? null,
          m: data.usd_30d_change ?? null,
        }
      }

      // 2) fallback: zoek id(s) + market_chart berekening
      const searchIds = aliases.length ? aliases : await searchCG(baseSymbolFromBinance(sym))
      for (const id of searchIds) {
        try {
          const r = await fetchMarketChartPrice(id)
          return { symbol: sym, ...r }
        } catch {/* try next id */}
      }

      // 3) niets gevonden
      return { symbol: sym, price: null, d: null, w: null, m: null }
    }))

    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60')
    return res.status(200).json({ results })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}