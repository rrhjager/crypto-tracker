// src/lib/refreshSnapshots.ts
import { snapKey, writeSnap } from './kvSnap'

/**
 * Deze functie haalt dezelfde bronnen op die je API's normaal zouden aanroepen
 * en zet de samengevatte payloads alvast in KV,
 * zodat elke pagina/API ms-snel kan serveren.
 *
 * Let op:
 * - We roepen je bestaande API-routes aan (self-call) om identical logic te behouden.
 * - We gebruiken absolute URL op basis van VERCEL_URL/URL-fallback.
 */

const TIMEOUT_MS = 12_000

function baseUrl() {
  // Vercel runtime: VERCEL_URL zonder protocol -> voeg https:// toe
  const v = process.env.VERCEL_URL
  if (v) return `https://${v}`
  // lokale fallback
  return process.env.SITE_ORIGIN || 'http://localhost:3000'
}

async function hit<T = any>(path: string): Promise<T> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(`${baseUrl()}${path}`, { cache: 'no-store', signal: ctl.signal, headers: { 'x-prewarm': '1' }})
    if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

// utility om csv batches te maken (crypto)
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
const toBinancePair = (s: string) => {
  const x = (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const skip = new Set(['USDT','USDC','BUSD','DAI','TUSD'])
  if (!x || skip.has(x)) return null
  return `${x}USDT`
}

// ==== Vul hier jouw universa in (identiek aan je pages) ====
const COINS = [
  'BTC','ETH','BNB','SOL','XRP','ADA','DOGE','TON','TRX','AVAX',
  'DOT','LINK','BCH','LTC','MATIC','XLM','NEAR','ICP','ETC','FIL',
  'XMR','APT','ARB','OP','SUI','HBAR','ALGO','VET','EGLD','AAVE',
  'INJ','MKR','RUNE','IMX','FLOW','SAND','MANA','AXS','QNT','GRT',
  'CHZ','CRV','ENJ','FTM','XTZ','LDO','SNX','STX','AR','GMX'
]

const NEWS_LOCALE = 'hl=en-US&gl=US&ceid=US:en'
const nowMin = () => Math.floor(Date.now()/60_000)

export async function refreshAllSnapshots(): Promise<{
  ok: true,
  refreshed: string[]
}> {
  const touched: string[] = []
  const v = nowMin()

  // 1) News
  {
    const q1 = 'crypto OR bitcoin OR ethereum OR blockchain'
    const newsCrypto = await hit(`/api/news/google?q=${encodeURIComponent(q1)}&${NEWS_LOCALE}&v=${v}`)
    await writeSnap(snapKey.news(q1), newsCrypto); touched.push(`news:${q1}`)

    const q2 = 'equities OR stocks OR stock market OR aandelen OR beurs'
    const newsEq = await hit(`/api/news/google?q=${encodeURIComponent(q2)}&${NEWS_LOCALE}&v=${v}`)
    await writeSnap(snapKey.news(q2), newsEq); touched.push(`news:${q2}`)
  }

  // 2) Congress & Academy
  {
    const congress = await hit(`/api/market/congress?limit=30&v=${v}`)
    await writeSnap(snapKey.congress(30), congress); touched.push('congress:30')

    const academy = await hit(`/api/academy/list?v=${v}`)
    await writeSnap(snapKey.academy(), academy); touched.push('academy')
  }

  // 3) Crypto batches (indicators + prices)
  {
    const pairs = COINS.map(toBinancePair).filter(Boolean) as string[]
    const groups = chunk(pairs, 12)
    for (const g of groups) {
      const csv = encodeURIComponent(g.join(','))
      const ind = await hit(`/api/crypto-light/indicators?symbols=${csv}&v=${v}`)
      await writeSnap(snapKey.cryptoInd(csv), ind); touched.push(`cr:ind:${csv}`)

      const px  = await hit(`/api/crypto-light/prices?symbols=${csv}&v=${v}`)
      await writeSnap(snapKey.cryptoPx(csv), px); touched.push(`cr:px:${csv}`)
    }
  }

  // 4) (Optioneel) Voor je homepage equities “Top BUY/SELL per beurs”:
  //    je huidige homepage berekent dit client-side uit individuele endpoints.
  //    Wil je die ook pre-snapshotten als 1 payload, voeg dan een API toe
  //    (bijv. /api/snapshots/home-equities) die precies dezelfde uitkomst levert
  //    en sla die payload hier op met snapKey.custom('home:eq').
  //    => Functioneel blijft alles gelijk; snelheid ms.

  return { ok: true, refreshed: touched }
}