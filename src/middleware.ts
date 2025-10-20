// middleware.ts  (zet dezelfde file óók in /src/middleware.ts)
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 1) Publieke API-routes die je frontend mag gebruiken
const PUBLIC_ALLOW = [
  '/api/quotes',
  '/api/indicators/ret-batch',
  '/api/indicators/snapshot',
  '/api/indicators/snapshot-list',
  '/api/crypto-light/indicators', // crypto indicators (als je /crypto gebruikt)
  '/api/crypto-light/prices',     // ✅ crypto prijzen endpoint (nieuw)
  '/api/market/',                 // ✅ alle Market-Intel subroutes (sectors/macro/hedgefunds/congress/aggregate)
]

// 2) Interne routes (cron/warmup/health)
const INTERNAL_ALLOW = [
  '/api/internal/',
  '/api/warm-cache',
  '/api/ping',
  '/api/kv-health',
]

// 3) Bot/preview user-agents blokkeren (alleen voor API)
const BOT_UA = [
  'bot','crawler','spider','crawling','preview',
  'facebookexternalhit','twitterbot','slackbot','discordbot','embedly',
  'bingpreview','ahrefs','semrush','mj12bot','seokicks','yandex','petalbot'
]
const isBot = (ua: string | null) =>
  ua ? BOT_UA.some(k => ua.toLowerCase().includes(k)) : false

// 4) Alleen jouw domeinen
function isSameOrigin(req: NextRequest) {
  const host = req.headers.get('host') || ''
  const origin = req.headers.get('origin') || ''
  const referer = req.headers.get('referer') || ''
  const allowed = ['signalhub.tech','www.signalhub.tech']
  const okHost    = allowed.some(h => host.endsWith(h))
  const okOrigin  = !origin  || allowed.some(h => origin.includes(h))
  const okReferer = !referer || allowed.some(h => referer.includes(h))
  return okHost && okOrigin && okReferer
}

// 5) Query-sanity: limiter voor symbols & markt
const MARKET_ALLOW = new Set([
  'AEX','DAX','FTSE 100','S&P 500','NASDAQ','Dow Jones',
  'Nikkei 225','Hang Seng','Sensex'
])
const countSymbols = (p: string | null) =>
  p ? p.split(',').map(s => s.trim()).filter(Boolean).length : 0

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl

  // Alleen API beschermen; HTML/SEO vrijlaten
  if (!pathname.startsWith('/api/')) return NextResponse.next()

  // Preflight/HEAD altijd doorlaten
  if (req.method === 'OPTIONS' || req.method === 'HEAD') return NextResponse.next()

  // Interne paden vrij
  if (INTERNAL_ALLOW.some(pfx => pathname.startsWith(pfx))) return NextResponse.next()

  // Whitelist toepassen
  if (!PUBLIC_ALLOW.some(pfx => pathname.startsWith(pfx))) {
    return new NextResponse('Forbidden (not allowed)', {
      status: 403,
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
    })
  }

  // Bots blokkeren (edge-gecachede 403)
  if (isBot(req.headers.get('user-agent'))) {
    return new NextResponse('Forbidden for bots', {
      status: 403,
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
    })
  }

  // Alleen jouw site (origin/referer/host)
  if (!isSameOrigin(req)) {
    return new NextResponse('Forbidden (origin)', {
      status: 403,
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
    })
  }

  // === Limiter op query-grootte (quotes/snapshot/ret-batch/crypto) ===
  const isQuotes = pathname.startsWith('/api/quotes')
  const isSnap   = pathname.startsWith('/api/indicators/snapshot-list')
  const isRet    = pathname.startsWith('/api/indicators/ret-batch')
  const isCryptoI= pathname.startsWith('/api/crypto-light/indicators')
  const isCryptoP= pathname.startsWith('/api/crypto-light/prices')

  if (isQuotes || isSnap || isRet || isCryptoI || isCryptoP) {
    const symCount = countSymbols(searchParams.get('symbols'))
    if (symCount > 60) {
      return new NextResponse('Too many symbols (max 60)', { status: 400 })
    }

    const market = searchParams.get('market')
    if (market && !MARKET_ALLOW.has(market)) {
      return new NextResponse('Unknown market', { status: 400 })
    }

    const rawQuery = req.url.split('?', 2)[1] || ''
    if (rawQuery.length > 2048) {
      return new NextResponse('Query too long', { status: 414 })
    }
  }

  return NextResponse.next()
}

// Alleen API-routes
export const config = { matcher: ['/api/:path*'] }