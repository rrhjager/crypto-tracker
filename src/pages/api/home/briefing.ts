// src/pages/api/home/briefing.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export const config = { runtime: 'nodejs' }

type NewsIn = { title: string; link: string; source?: string; pubDate?: string }
type NewsItem = { title: string; url: string; source?: string; published?: string }
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

async function fetchNews(req: NextApiRequest, query: string): Promise<NewsItem[]> {
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

function sanitizePlain(s: string): string {
  let out = (s || '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  out = out.replace(/\b(Bullet|Point)\s*\d+\b/g, '')
  if (out.length > 800) out = out.slice(0, 800)
  return out
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BriefingResp | { error: string }>
) {
  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' })

    const [newsCrypto, newsEq, newsMacro, congress] = await Promise.all([
      fetchNews(req, 'crypto OR bitcoin OR ethereum OR blockchain'),
      fetchNews(req, 'equities OR stocks OR stock market OR earnings OR S&P500 OR Nasdaq'),
      fetchNews(req, 'CPI OR inflation OR FOMC OR rate decision OR payrolls OR PMI OR SEC OR ETF OR geopolitics OR sanctions OR oil OR USD'),
      fetchCongress(req),
    ])

    const todayISO = new Date().toISOString().slice(0, 10)

    const system = [
      'You are a professional markets analyst.',
      'Write a very concise investor briefing in 3–4 short bullet points (max 150 words total).',
      'Each bullet must start with "• **Topic:** ..." where the topic is bold (like Macro, Crypto, Equities, Congress).',
      'Each bullet should describe the event/news and end with what it likely means for equities and crypto markets (positive, negative, neutral).',
      'Be factual, specific, and analytical. No generic advice, no repetition.',
      'Conclude with one line starting with "Takeaway:" summarizing the short-term outlook.',
      'Format cleanly as Markdown with bullets and bold topic names.'
    ].join(' ')

    const userPayload = {
      date: todayISO,
      tz_hint: 'Europe/Amsterdam',
      news_crypto: newsCrypto,
      news_equities: newsEq,
      news_macro: newsMacro,
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
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Use this JSON as your only data source:\n${JSON.stringify(userPayload)}` }
        ]
      })
    })

    if (!r.ok) {
      const tx = await r.text()
      return res.status(500).json({ error: `OpenAI error: ${tx}` })
    }

    const data = await r.json()
    const raw = (data?.choices?.[0]?.message?.content || '').trim()
    const advice = sanitizePlain(raw)

    res.setHeader('Cache-Control', `public, s-maxage=${TTL_S}, stale-while-revalidate=60`)
    return res.status(200).json({ advice })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}