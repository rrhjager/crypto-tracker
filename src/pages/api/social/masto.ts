// src/pages/api/social/masto.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'

type MastoStatus = {
  id: string
  url: string | null
  created_at: string
  content: string
  account: {
    id: string
    acct: string
    username: string
    display_name: string
    url: string
    avatar: string
    followers_count?: number
  }
  media_attachments?: Array<{
    url: string
    preview_url: string
    type: 'image' | 'gifv' | 'video' | string
    description?: string | null
  }>
}

type Item = {
  id: string
  url: string
  createdAt: string
  text: string
  author: {
    handle: string
    name: string
    avatar: string
    followers: number
    profileUrl: string
  }
  image?: string | null
  source: 'mastodon'
  instance: string
  tag: string
}

function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function fetchTagFromInstance(instance: string, tag: string, limit = 40): Promise<MastoStatus[]> {
  const url = `https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${Math.min(
    Math.max(limit, 1),
    40
  )}`
  const r = await fetch(url, {
    headers: {
      'cache-control': 'no-cache',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    },
  })
  if (!r.ok) throw new Error(`${instance} HTTP ${r.status}`)
  return (await r.json()) as MastoStatus[]
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const tag = String(req.query.tag || 'stocks') // voorbeeld: stocks, markets, crypto
    const minFollowers = Number(req.query.minFollowers ?? 100000) || 100000
    const instances = (String(req.query.instances || '').trim()
      ? String(req.query.instances).split(',').map((s) => s.trim()).filter(Boolean)
      : ['mastodon.social', 'mstdn.social', 'mastodon.online']) as string[]

    const all: Item[] = []

    // Vriendelijk parallelliseren
    await Promise.all(
      instances.map(async (inst) => {
        try {
          const rows = await fetchTagFromInstance(inst, tag, 40)
          for (const s of rows) {
            const f = Number(s.account?.followers_count ?? 0)
            if (f < minFollowers) continue
            if (!s.url) continue
            all.push({
              id: `${inst}:${s.id}`,
              url: s.url,
              createdAt: s.created_at,
              text: stripHtml(s.content).slice(0, 400),
              author: {
                handle: s.account?.acct || s.account?.username || '',
                name: s.account?.display_name || s.account?.username || '',
                avatar: s.account?.avatar || '',
                followers: f,
                profileUrl: s.account?.url || '',
              },
              image: s.media_attachments?.find((m) => m.type === 'image')?.preview_url ?? null,
              source: 'mastodon',
              instance: inst,
              tag,
            })
          }
        } catch {
          /* sla fouten per instance over */
        }
      })
    )

    // sorteer: meest recente eerst
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600')
    return res.status(200).json({ items: all.slice(0, 24), meta: { tag, minFollowers, instances } })
  } catch (e: any) {
    return res.status(502).json({ items: [], error: String(e?.message || e) })
  }
}