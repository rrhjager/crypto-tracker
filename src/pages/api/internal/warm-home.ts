// src/pages/api/internal/warm-home.ts
export const config = { runtime: 'edge' }

export default async function handler() {
  try {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      `https://${process.env.VERCEL_URL || 'signalhub.tech'}`
    // Tik de snapshot aan; KV en edge-mem worden ververst
    await fetch(`${base}/api/home/snapshot`, { cache: 'no-store' })
    return new Response('ok', { status: 200 })
  } catch (e: any) {
    return new Response(String(e?.message || e), { status: 500 })
  }
}