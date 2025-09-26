import type { NextApiRequest, NextApiResponse } from 'next'

type Coin = {
  symbol: string
  name?: string
  status?: 'BUY'|'HOLD'|'SELL'
  score?: number
  [k: string]: any
}
type Item = { symbol: string; name?: string; score?: number }
type Ok = { items: Item[]; meta?: any }
type Err = { error: string }

// ---------- helpers ----------
function getOrigin(req: NextApiRequest) {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'http'
  const host  = (req.headers['x-forwarded-host'] as string)  || (req.headers.host as string) || 'localhost:3000'
  return `${proto}://${host}`
}
function abs(origin: string, path: string) {
  return path.startsWith('http') ? path : `${origin}${path}`
}
async function getJson(url: string) {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  try { return await r.json() } catch { return null }
}

function mapAnyToItems(j: any): Item[] {
  if (!j) return []
  const map = (arr: any[]) => arr.map((x:any)=>({
    symbol: x.symbol,
    name: x.name,
    score: Number.isFinite(Number(x.score)) ? Number(x.score) : undefined
  }))
  if (Array.isArray(j.items))  return map(j.items.filter((x:Coin)=>x.status==='BUY'||Number(x.score)>0))
  if (Array.isArray(j.buys))   return map(j.buys)
  if (Array.isArray(j.data))   return map(j.data)
  if (Array.isArray(j.coins))  return map(j.coins.filter((x:Coin)=>x.status==='BUY'||Number(x.score)>0))
  if (Array.isArray(j))        return map(j.filter((x:Coin)=>x.status==='BUY'||Number(x.score)>0))
  return []
}

function mapAnyToTopByScore(j: any, limit = 8): Item[] {
  if (!j) return []
  const pick = (arr: any[]) =>
    arr
      .map((x:any)=>({ symbol: x.symbol, name: x.name, score: Number(x.score) }))
      .filter((x:Item)=>x.symbol && Number.isFinite(x.score as number))
      .sort((a,b)=>Number(b.score ?? 0) - Number(a.score ?? 0))
      .slice(0, limit)

  if (Array.isArray(j.items))  return pick(j.items)
  if (Array.isArray(j.buys))   return pick(j.buys)
  if (Array.isArray(j.data))   return pick(j.data)
  if (Array.isArray(j.coins))  return pick(j.coins)
  if (Array.isArray(j))        return pick(j)
  return []
}

// ---------- CoinGecko fallback (altijd werkt) ----------
async function coingeckoTop(): Promise<Item[]> {
  // Markets endpoint: top-50 op market cap, incl. 24h % change
  const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&price_change_percentage=24h'
  const arr: any[] = await getJson(url)

  // Simpele score: hogere 24h% => hogere score. Negatief = geen BUY (score 0).
  // Je kunt dit gewenste gewicht later tweaken.
  const items = (arr || [])
    .map((c:any) => {
      const symbol = String(c.symbol || '').toUpperCase()
      const name   = String(c.name || symbol)
      const ch24   = Number(c.price_change_percentage_24h)
      const score  = Number.isFinite(ch24) ? Math.max(0, ch24) : 0
      return { symbol, name, score }
    })
    .filter((x: Item) => x.symbol && Number.isFinite(x.score as number))
    .sort((a,b)=> Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, 8)

  return items
}

// ---------- handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse<Ok|Err>) {
  const debug = String(req.query.debug || '') === '1'
  const tried: any[] = []
  const origin = getOrigin(req)

  try {
    // 1) Probeer jouw interne BUY-bronnen
    const candidates = [
      '/api/coin/screener?status=BUY&limit=24',
      '/api/coin/top-buys',
      '/api/coin/buys',
      '/api/coin?limit=200',
      '/api/coin/list',
      '/api/coin/summary',
    ]

    for (const path of candidates) {
      const url = abs(origin, path)
      try {
        const j = await getJson(url)
        let items = mapAnyToItems(j)
          .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
          .slice(0, 8)
        tried.push({ url, ok: true, buysFound: items.length })
        if (items.length > 0) {
          return res.status(200).json(debug ? { items, meta: { mode: 'BUY', used: url, tried } } : { items })
        }
      } catch (e: any) {
        tried.push({ url, ok: false, error: String(e?.message || e) })
      }
    }

    // 2) Fallback: Top op score uit je eigen lijst (als die bestaat)
    try {
      const url = abs(origin, '/api/coin?limit=200')
      const j = await getJson(url)
      const items = mapAnyToTopByScore(j, 8)
      tried.push({ url, ok: true, fallbackTopScore: items.length })
      if (items.length > 0) {
        return res.status(200).json(debug ? { items, meta: { mode: 'TOP_SCORE', used: url, tried } } : { items })
      }
    } catch (e:any) {
      tried.push({ url: abs(origin, '/api/coin?limit=200'), ok: false, error: String(e?.message||e) })
    }

    // 3) Laatste redmiddel: CoinGecko (publieke data)
    try {
      const items = await coingeckoTop()
      tried.push({ url: 'coingecko:markets', ok: true, count: items.length })
      return res.status(200).json(debug ? { items, meta: { mode: 'COINGECKO', used: 'coingecko:markets', tried } } : { items })
    } catch (e:any) {
      tried.push({ url: 'coingecko:markets', ok: false, error: String(e?.message||e) })
      return res.status(200).json(debug ? { items: [], meta: { mode: 'EMPTY', tried } } : { items: [] })
    }
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || e) })
  }
}