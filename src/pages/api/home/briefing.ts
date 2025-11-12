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
  // verwijder markdown bold/italic/headings/listsymbolen en dubbele spaties
  let out = (s || '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*-\s+/gm, '• ')
    .replace(/^\s*\u2022\s*/gm, '• ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // veiligheidsnet: zorg dat bullets beginnen met "• "
  out = out.replace(/^\s*(?:\-|•)?\s*(?=What|Biggest|Other)/m, '• ')
  // max ~1200 chars om te voorkomen dat het uit de hand loopt
  if (out.length > 1200) out = out.slice(0, 1200)
  return out
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BriefingResp | { error: string }>
) {
  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' })

    // Haal lichtgewicht context op
    const [newsCrypto, newsEq, newsMacro, congress] = await Promise.all([
      fetchNews(req, 'crypto OR bitcoin OR ethereum OR blockchain'),
      fetchNews(req, 'equities OR stocks OR stock market OR earnings'),
      // extra query’s gericht op macro/kalender/regulatie/geopolitiek (buiten je eigen site)
      fetchNews(req, 'CPI OR inflation OR FOMC OR rate decision OR payrolls OR PMI OR SEC OR ETF OR sanctions OR geopolitics'),
      fetchCongress(req),
    ])

    const todayISO = new Date().toISOString().slice(0, 10)

    // ——— LLM prompt ———
    // Doel: 3 bullets + korte takeaway, geen markdown, geen sterretjes.
    const system = [
      'You are a markets analyst writing a concise intraday briefing for active investors.',
      'Write in plain text only (no markdown, no asterisks).',
      'Keep it tight (~120–150 words).',
      'Output format:',
      '• Bullet 1: What to watch TODAY (macro events/earnings/known catalysts).',
      '• Bullet 2: Biggest BUY in US Congress trades YESTERDAY (if any); otherwise skip this bullet entirely.',
      '• Bullet 3: Other key risks/opportunities likely to impact equities or crypto today (regulation, ETFs, geopolitics, liquidity, positioning).',
      'Then a single-sentence line starting with "Takeaway:" on the likely market posture (risk-on/off, volatility, defensives vs cyclicals).',
      'Use only the provided items; do not invent facts. Prefer specific tickers/events when present.',
      'Do not include any asterisks or markdown symbols.'
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
        temperature: 0.25,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Use this JSON as your only source:\n${JSON.stringify(userPayload)}` }
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