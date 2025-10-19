// /middleware.ts (projectroot)
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Bekende bot/preview user-agents
const BOT_UA = [
  'bot','crawler','spider','crawling','preview',
  'facebookexternalhit','twitterbot','slackbot','discordbot','embedly','quora link preview',
  'semrush','ahrefs','yandex','bingpreview','petalbot','seokicks','mj12bot'
]

// Whitelist: interne routes die je zelf triggert (cron/warmup/health)
const INTERNAL_ALLOW = [
  '/api/internal/',     // bijv. /api/internal/warmup
  '/api/warm-cache',    // jouw bestaande warm-cache route
]

function isBot(ua: string | null) {
  if (!ua) return false
  const s = ua.toLowerCase()
  return BOT_UA.some(k => s.includes(k))
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Alleen API beschermen; HTML/SEO blijven vrij
  if (pathname.startsWith('/api/')) {
    // Sta interne paden altijd toe (cron/warmup/health)
    if (INTERNAL_ALLOW.some(prefix => pathname.startsWith(prefix))) {
      return NextResponse.next()
    }

    // Blokkeer bots op API en cache de 403 lang op de edge (extreem goedkoop)
    const ua = req.headers.get('user-agent')
    if (isBot(ua)) {
      return new NextResponse('Forbidden for bots', {
        status: 403,
        headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
      })
    }
  }
  return NextResponse.next()
}

// Laat middleware alleen op API-routes draaien
export const config = {
  matcher: ['/api/:path*']
}
