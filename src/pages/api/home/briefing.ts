// src/pages/api/home/briefing.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export const config = { runtime: 'nodejs' }

type NewsIn = { title: string; link: string; source?: string; pubDate?: string }
type CongressTrade = {
  person?: string; ticker?: string; side?: string;
  amount?: string | number; price?: string | number | null;
  date?: string; url?: string;
}

type BriefingResp = { advice: string }

const TTL_S = 600 // 10 min CDN-cache

function baseUrl(req: NextApiRequest) {
  const envBase = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '')
  if (envBase) return envBase
  const proto = (req.headers['x-forwarded-proto'] as string) || 'http'
  const host = req.headers.host
  return `${proto}://${host}`
}

async function fetchNews(req: NextApiRequest, query: string) {
  const url = `${baseUrl(req)}/api/news/google?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return []
    const j = await r.json() as { items?: NewsIn[] }
    return (j.items || []).slice(0, 8).map(x => ({
      title: x.title || '',
      url: (x as any).link || '',
      source: x.source || '',
      published: x.pubDate || ''
    }))
  } catch { return [] }
}

async function fetchCongress(req: NextApiRequest): Promise<CongressTrade[]> {
  try {
    const r = await fetch(`${baseUrl(req)}/api/market/congress?limit=40`, { cache: 'no-store' })
    if (!r.ok) return []
    const j = await r.json() as { items?: any[] }
    return Array.isArray(j?.items) ? j.items : []
  } catch { return [] }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BriefingResp | { error: string }>
) {
  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' })

    const [newsCrypto, newsEq, congress] = await Promise.all([
      fetchNews(req, 'crypto OR bitcoin OR ethereum OR blockchain'),
      fetchNews(req, 'equities OR stocks OR stock market OR earnings OR CPI OR FOMC'),
      fetchCongress(req),
    ])

    const todayISO = new Date().toISOString().slice(0, 10)
    const system = [
      'You are a markets analyst. Write a crisp morning briefing for active investors.',
      'Keep it objective and specific. Max ~150 words.',
      'Output strictly: three bullet points, then a single-sentence takeaway starting with "Takeaway:".',
      'Bullets:',
      '1) What to watch TODAY (events/earnings/Macro).',
      '2) Biggest BUY in Congress trades YESTERDAY if any; otherwise skip this bullet.',
      '3) Other risks/opportunities (equities or crypto).',
      'Do NOT invent facts; only use provided items.'
    ].join(' ')

    const user = {
      date: todayISO,
      news_crypto: newsCrypto,
      news_equities: newsEq,
      congress_recent: congress,
    }

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Use this JSON as your only source:\n${JSON.stringify(user)}` }
        ]
      })
    })

    if (!r.ok) {
      const tx = await r.text()
      return res.status(500).json({ error: `OpenAI error: ${tx}` })
    }
    const data = await r.json()
    const advice = (data?.choices?.[0]?.message?.content || '').trim()

    res.setHeader('Cache-Control', `public, s-maxage=${TTL_S}, stale-while-revalidate=60`)
    return res.status(200).json({ advice })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}