import type { NextApiRequest, NextApiResponse } from 'next'
import { kv } from '@vercel/kv'

export const config = { runtime: 'nodejs' }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const key = 'diag:kv:ping'
    const now = Date.now()
    await kv.set(key, String(now), { ex: 60 })
    const got = await kv.get<string>(key)
    return res.status(200).json({ ok: true, wrote: now, read: got })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) })
  }
}