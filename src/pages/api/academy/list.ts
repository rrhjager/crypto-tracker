// src/pages/api/academy/list.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs/promises'
import path from 'path'

// pages/api draait standaard op Node, maar we houden het simpel en robuust.

type Item = { title: string; href: string }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const root = process.cwd()
    const candidates = [
      path.join(root, 'content', 'academy'),
      path.join(root, 'src', 'content', 'academy'),
      path.join(root, 'public', 'academy'),
    ]

    let dir = ''
    for (const p of candidates) {
      try {
        const s = await fs.stat(p)
        if (s.isDirectory()) { dir = p; break }
      } catch {}
    }

    if (!dir) {
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
      return res.status(200).json({ items: [] as Item[] })
    }

    const files = await fs.readdir(dir).catch(() => [])
    const items: Item[] = []
    for (const f of files) {
      if (!/\.mdx?$|\.md$|\.json$/.test(f)) continue
      const slug = f.replace(/\.(mdx?|json)$/, '')
      const title = slug.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
      items.push({ title, href: `/academy/${slug}` })
    }

    items.sort((a, b) => a.title.localeCompare(b.title))
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return res.status(200).json({ items })
  } catch {
    // Nooit 500 teruggeven — laat de homepage fallback zien
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120')
    return res.status(200).json({ items: [] as Item[] })
  }
}