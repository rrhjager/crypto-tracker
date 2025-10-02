import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const domain = String(req.query.domain || '').replace(/[^a-z0-9.\-]/gi, '')
  if (!domain) { res.status(400).end('Bad request'); return }

  // probeer Google → fallback DDG
  const sources = [
    `https://www.google.com/s2/favicons?sz=64&domain=${domain}`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ]

  for (const url of sources) {
    try {
      const r = await fetch(url)
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer())
        const ct = r.headers.get('content-type') || 'image/x-icon'
        res.setHeader('Content-Type', ct)
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable')
        res.status(200).send(buf)
        return
      }
    } catch {}
  }

  // geen ico gevonden
  res.status(204).end()
}