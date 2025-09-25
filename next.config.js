/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  experimental: { typedRoutes: true },
  output: 'standalone',

  // VERWIJDERD: de rewrites die '/' en '/index' naar '/app' stuurden.
  async rewrites() {
    return [];
  },
};

module.exports = nextConfig;