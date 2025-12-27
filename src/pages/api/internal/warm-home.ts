// src/pages/api/internal/warm-home.ts
export const config = { runtime: 'edge' }

export default async function handler() {
  try {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      `https://${process.env.VERCEL_URL || 'signalhub.tech'}`

    // Force refresh → bouwt snapshot opnieuw en schrijft KV (home:snapshot:v3)
    const url = `${base}/api/home/snapshot?refresh=1`
    const headers: Record<string, string> = {}
    if (process.env.WARMUP_TOKEN) headers['x-warmup-token'] = process.env.WARMUP_TOKEN

    const r = await fetch(url, { cache: 'no-store', headers })
    if (!r.ok) return new Response(`warm-home failed: HTTP ${r.status}`, { status: 500 })

    return new Response('ok', { status: 200 })
  } catch (e: any) {
    return new Response(String(e?.message || e), { status: 500 })
  }
}