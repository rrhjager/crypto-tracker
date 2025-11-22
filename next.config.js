/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Zorg dat /index (als iemand dat intypt of ergens een oude link is)
  // gewoon naar de SSR-homepage op / gaat, niet meer naar /app.
  async rewrites() {
    return [
      { source: '/index', destination: '/' },
    ]
  },

  async headers() {
    const cacheHeaders = [
      { key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=86400' },
      { key: 'Vary', value: 'Accept-Encoding' },
    ]
    return [
      { source: '/api/indicators/:path*',    headers: cacheHeaders },
      { source: '/api/crypto-light/:path*',  headers: cacheHeaders },
      { source: '/api/screener/:path*',      headers: cacheHeaders },
      { source: '/api/v1/coins',             headers: cacheHeaders },
      { source: '/api/quotes',               headers: cacheHeaders },
      { source: '/api/stocks/news',          headers: cacheHeaders },
      { source: '/api/academy/list',         headers: cacheHeaders },
      // Geen cache op warmup/diag/ping
    ]
  },
}

module.exports = nextConfig