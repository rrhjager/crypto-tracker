import type { NextApiRequest, NextApiResponse } from 'next'
import { kv } from '@vercel/kv'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const key = 'health:kv:test'
    await kv.set(key, JSON.stringify({ ok: true, t: Date.now() }), { ex: 60 })
    const raw = await kv.get<string>(key)
    const parsed = raw ? JSON.parse(typeof raw === 'string' ? raw : String(raw)) : null
    res.status(200).json({
      env: {
        has_KV_REST_API_URL: !!process.env.KV_REST_API_URL,
        has_KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
      },
      read_ok: !!parsed,
      value: parsed,
    })
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) })
  }
}