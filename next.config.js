// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    async rewrites() {
      return [
        { source: '/index', destination: '/app' }, // '/index' opent je crypto tracker
      ]
    },
  }
  module.exports = nextConfig