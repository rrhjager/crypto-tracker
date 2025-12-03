import type { NextApiRequest, NextApiResponse } from 'next'
import { kv } from '@vercel/kv'

type HealthResponse = {
  env: {
    has_KV_REST_API_URL: boolean
    has_KV_REST_API_TOKEN: boolean
  }
  rawType: string | null
  read_ok: boolean
  value: unknown
} | {
  error: string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse>
) {
  try {
    const key = 'health:kv:test'

    // Schrijf een simpele testwaarde weg (object is OK)
    await kv.set(key, { ok: true, t: Date.now() }, { ex: 60 })

    // Lees hem terug
    const raw = await kv.get(key)

    let parsed: unknown = null
    if (raw != null) {
      if (typeof raw === 'string') {
        // Als het een string is, probeer JSON te parsen, anders laat hem als string
        try {
          parsed = JSON.parse(raw)
        } catch {
          parsed = raw
        }
      } else {
        // Voor objecten/nummers/etc gewoon direct teruggeven
        parsed = raw
      }
    }

    res.status(200).json({
      env: {
        has_KV_REST_API_URL: !!process.env.KV_REST_API_URL,
        has_KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
      },
      rawType: raw === null ? null : typeof raw,
      read_ok: raw != null,
      value: parsed,
    })
  } catch (e: any) {
    res.status(500).json({
      error: String(e?.message || e),
    })
  }
}