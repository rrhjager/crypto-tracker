// src/pages/api/social/masto.ts
export const config = { runtime: 'nodejs' }

import type { NextApiRequest, NextApiResponse } from 'next'

type MastoAccount = {
  id: string
  username: string
  acct: string
  url: string
  followers_count?: number
  display_name?: string
  avatar?: string
}

type MastoStatus = {
  id: string
  url: string
  created_at: string
  content: string
  reblogs_count: number
  favourites_count: number
  replies_count: number
  account: MastoAccount
  media_attachments?: Array<{ preview_url?: string; url?: string }>
}

type SocialPost = {
  id: string
  url: string
  createdAt: string
  text: string
  author: {
    handle: string
    name: string
    url: string
    avatar?: string
    followers?: number
  }
  likes: number
  reposts: number
  replies: number
  image?: string | null
  source: 'mastodon'
  tag: string
}

const DEFAULT_INSTANCE = 'https://mastodon.social'

// naive HTML → text cleaner
function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

async function fetchTagTimeline(instance: string, tag: string, limit = 40): Promise<MastoStatus[]> {
  const url = `${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${Math.min(
    Math.max(limit, 1),
    40
  )}`
  const r = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'cache-control': 'no-cache',
    },
  })
  if (!r.ok) throw new Error(`timeline ${tag}: HTTP ${r.status}`)
  return (await r.json()) as MastoStatus[]
}

async function fetchAccount(instance: string, id: string): Promise<MastoAccount> {
  const r = await fetch(`${instance}/api/v1/accounts/${encodeURIComponent(id)}`, {
    headers: { 'user-agent': 'SignalHub/1.0', 'cache-control': 'no-cache' },
  })
  if (!r.ok) throw new Error(`account ${id}: HTTP ${r.status}`)
  return (await r.json()) as MastoAccount
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      tags: tagsRaw,
      tag,
      instance = DEFAULT_INSTANCE,
      limit: limitRaw,
      minFollowers: minFollowersRaw,
    } = req.query as Record<string, string>

    const limit = Math.max(5, Math.min(Number(limitRaw || 20), 40))

    // tags can be a comma list, plus backwards-compat single "tag"
    const tags =
      (tagsRaw ? tagsRaw.split(',') : []).map((t) => t.trim()).filter(Boolean) ||
      (tag ? [tag] : [])
    const usedTags =
      tags.length > 0
        ? tags
        : ['markets', 'stocks', 'investing', 'finance', 'bitcoin', 'crypto']

    // requested floor
    const requestedMin = Number(minFollowersRaw ?? '10000')
    // progressive relaxation floors
    const floors = [requestedMin, 5000, 2000, 0].filter(
      (v, i, a) => Number.isFinite(v) && v >= 0 && a.indexOf(v) === i
    )

    let collected: SocialPost[] = []
    let usedFloor = floors[floors.length - 1]

    for (const floor of floors) {
      usedFloor = floor
      collected = []
      // gather across tags
      for (const t of usedTags) {
        let statuses: MastoStatus[] = []
        try {
          statuses = await fetchTagTimeline(instance, t, limit)
        } catch {
          continue
        }

        // fill in followers_count (some timelines omit it)
        const enriched = await Promise.all(
          statuses.map(async (s) => {
            if (typeof s.account?.followers_count === 'number') return s
            try {
              const acc = await fetchAccount(instance, s.account.id)
              s.account.followers_count = acc.followers_count
              s.account.display_name = s.account.display_name || acc.display_name
              s.account.avatar = s.account.avatar || acc.avatar
              s.account.url = s.account.url || acc.url
            } catch {}
            return s
          })
        )

        const filtered = enriched
          .filter((s) => (s.account?.followers_count || 0) >= floor)
          .slice(0, limit)

        const mapped: SocialPost[] = filtered.map((s) => ({
          id: s.id,
          url: s.url,
          createdAt: s.created_at,
          text: stripHtml(s.content),
          author: {
            handle: s.account?.acct || s.account?.username || '',
            name: s.account?.display_name || s.account?.username || '',
            url: s.account?.url || '',
            avatar: s.account?.avatar,
            followers: s.account?.followers_count,
          },
          likes: s.favourites_count ?? 0,
          reposts: s.reblogs_count ?? 0,
          replies: s.replies_count ?? 0,
          image: s.media_attachments?.[0]?.preview_url || null,
          source: 'mastodon',
          tag: t,
        }))

        collected.push(...mapped)
      }

      // stop relaxing if we found enough
      if (collected.length >= Math.min(limit, 12)) break
    }

    // rank: likes + reblogs, then newest
    collected.sort((a, b) => {
      const aw = (a.likes || 0) + (a.reposts || 0)
      const bw = (b.likes || 0) + (b.reposts || 0)
      if (bw !== aw) return bw - aw
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    // cap output
    const out = collected.slice(0, limit)

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300')
    return res.status(200).json({
      items: out,
      meta: {
        tags: usedTags,
        instance,
        limit,
        minFollowersTried: floors,
        minFollowersUsed: usedFloor,
        found: out.length,
      },
    })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' })
  }
}