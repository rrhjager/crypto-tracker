// src/pages/api/internal/warm-home.ts
export const config = { runtime: 'edge' }

export default async function handler() {
  try {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      `https://${process.env.VERCEL_URL || 'signalhub.tech'}`

    // Warm de échte snapshot (zodat home:snapshot:v2 KV wordt geschreven)
    const url = `${base}/api/home/snapshot`
    const headers: Record<string, string> = {}
    if (process.env.WARMUP_TOKEN) headers['x-warmup-token'] = process.env.WARMUP_TOKEN

    const r = await fetch(url, { cache: 'no-store', headers })
    if (!r.ok) {
      return new Response(`warm-home failed: HTTP ${r.status}`, { status: 500 })
    }

    return new Response('ok', { status: 200 })
  } catch (e: any) {
    return new Response(String(e?.message || e), { status: 500 })
  }
}