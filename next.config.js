// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/index', destination: '/app' }]
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