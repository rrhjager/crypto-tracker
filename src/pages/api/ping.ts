// src/pages/api/ping.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({
    ok: true,
    now: new Date().toISOString(),
    debug: req.query.debug ?? null,
  })
}