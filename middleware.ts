// middleware.ts  (zet dezelfde file óók in /src/middleware.ts)
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// ===== 1) Publieke API-routes die je frontend mag gebruiken =====
// Voeg hier alleen de LEZENDE/batch routes toe die écht nodig zijn.
const PUBLIC_ALLOW = [
  '/api/quotes',
  '/api/indicators/ret-batch',
  '/api/indicators/snapshot',
  '/api/indicators/snapshot-list',
  '/api/crypto-light/indicators', // laat staan als je deze gebruikt
]

// ===== 2) Interne routes (cron/warmup/health) =====
const INTERNAL_ALLOW = [
  '/api/internal/',
  '/api/warm-cache',
  '/api/ping',
  '/api/kv-health',
]

// ===== 3) Bot/preview user-agents blokkeren =====
const BOT_UA = [
  'bot','crawler','spider','crawling','preview',
  'facebookexternalhit','twitterbot','slackbot','discordbot','embedly',
  'bingpreview','ahrefs','semrush','mj12bot','seokicks','yandex','petalbot'
]
const isBot = (ua: string | null) => ua ? BOT_UA.some(k => ua.toLowerCase().includes(k)) : false

// ===== 4) Alleen jouw domein mag de API consumeren (beschermt tegen off-site scraping) =====
function isSameOrigin(req: NextRequest) {
  const host = req.headers.get('host') || ''
  const origin = req.headers.get('origin') || ''
  const referer = req.headers.get('referer') || ''
  const allowed = ['signalhub.tech','www.signalhub.tech'] // <-- jouw domeinen
  const okHost    = allowed.some(h => host.endsWith(h))
  const okOrigin  = !origin  || allowed.some(h => origin.includes(h))
  const okReferer = !referer || allowed.some(h => referer.includes(h))
  return okHost && okOrigin && okReferer
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Alleen API beschermen; HTML/SEO blijven vrij
  if (!pathname.startsWith('/api/')) return NextResponse.next()

  // Preflight/HEAD gewoon doorlaten
  if (req.method === 'OPTIONS' || req.method === 'HEAD') return NextResponse.next()

  // Interne paden altijd toestaan
  if (INTERNAL_ALLOW.some(pfx => pathname.startsWith(pfx))) {
    return NextResponse.next()
  }

  // Publieke API alléén wat we whitelisten
  const allowed = PUBLIC_ALLOW.some(pfx => pathname.startsWith(pfx))
  if (!allowed) {
    return new NextResponse('Forbidden (not allowed)', {
      status: 403,
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
    })
  }

  // Bots blokkeren op de allowed paden
  if (isBot(req.headers.get('user-agent'))) {
    return new NextResponse('Forbidden for bots', {
      status: 403,
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
    })
  }

  // Alleen jouw site (origin/referer/host) mag de allowed API gebruiken
  if (!isSameOrigin(req)) {
    return new NextResponse('Forbidden (origin)', {
      status: 403,
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
    })
  }

  return NextResponse.next()
}

// Laat middleware alleen op API-routes draaien
export const config = { matcher: ['/api/:path*'] }