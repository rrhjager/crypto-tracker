// src/pages/api/market/macro/index.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export const config = { runtime: 'nodejs' }

type Row = {
  dateISO: string
  dateLabel: string
  event: string
  impact: 'low'|'medium'|'high'
  region: string
  sourceUrl: string
}

type Indicator = {
  name: string
  seriesId: string
  impact: 'low'|'medium'|'high'
  region?: string
}

const INDICATORS: Indicator[] = [
  { name: 'US CPI (YoY)',              seriesId: 'CPIAUCSL', impact: 'high'   },
  { name: 'US Core CPI (YoY)',         seriesId: 'CPILFESL', impact: 'high'   },
  { name: 'US PCE (YoY)',              seriesId: 'PCEPI',    impact: 'high'   },
  { name: 'US Core PCE (YoY)',         seriesId: 'PCEPILFE', impact: 'high'   },
  { name: 'US Nonfarm Payrolls',       seriesId: 'PAYEMS',   impact: 'high'   },
  { name: 'US Retail Sales (MoM)',     seriesId: 'RSAFS',    impact: 'medium' },
  { name: 'US PPI (YoY)',              seriesId: 'PPIACO',   impact: 'medium' },
  { name: 'US Initial Jobless Claims', seriesId: 'ICSA',     impact: 'medium' },
  { name: 'U. Michigan Sentiment',     seriesId: 'UMCSENT',  impact: 'low'    },
]

const FRED_BASE = 'https://api.stlouisfed.org/fred'
const REGION = 'United States'

const iso = (d: Date) => d.toISOString().slice(0,10)
const nl = (isoStr: string) =>
  new Date(isoStr + 'T00:00:00Z').toLocaleDateString('nl-NL', { day:'2-digit', month:'short', year:'numeric' })

async function fetchJSON(url: string) {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`)
  return r.json()
}

async function getReleaseIdForSeries(apiKey: string, seriesId: string): Promise<number | null> {
  const u = `${FRED_BASE}/series/release?series_id=${encodeURIComponent(seriesId)}&api_key=${apiKey}&file_type=json`
  const j = await fetchJSON(u)
  const rel = (Array.isArray(j?.releases) ? j.releases[0] : j?.release) || null
  return (rel && typeof rel.id === 'number') ? rel.id : null
}

async function getFutureReleaseDates(apiKey: string, releaseId: number, fromISO: string, toISO: string): Promise<string[]> {
  const paths = ['release/dates', 'releases/dates']
  const paramsVariants = [
    `start=${fromISO}&end=${toISO}`,
    `realtime_start=${fromISO}&realtime_end=${toISO}`,
  ]
  for (const p of paths) {
    for (const q of paramsVariants) {
      try {
        const url = `${FRED_BASE}/${p}?release_id=${releaseId}&include_release_dates_with_no_data=true&${q}&api_key=${apiKey}&file_type=json&limit=1000`
        const j = await fetchJSON(url)
        const arr = Array.isArray(j?.release_dates) ? j.release_dates : []
        const out = arr
          .map((x: any) => String(x?.date || '').slice(0,10))
          .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
          .filter((d: string) => d >= fromISO && d <= toISO)
        if (out.length) return out
      } catch {
        // try next variant
      }
    }
  }
  return []
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // ✅ Key: uit env of desnoods uit query (handig voor testen)
    const apiKey = String(req.query.apiKey || process.env.FRED_API_KEY || '')

    const daysQ = Number(req.query.days)
    const windowDays = Number.isFinite(daysQ) ? Math.min(Math.max(daysQ, 7), 180) : 120

    const now = new Date()
    const fromISO = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())))
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    to.setUTCDate(to.getUTCDate() + windowDays)
    const toISO = iso(to)

    // ❗ Als er geen API key is, géén 400 meer → 200 met hint,
    // zodat de frontend netjes kan tonen wat er mis is i.p.v. te crashen.
    if (!apiKey) {
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({
        items: [],
        hint: 'FRED_API_KEY ontbreekt (haal gratis key op fred.stlouisfed.org en zet in Vercel env). Je kunt ook tijdelijk ?apiKey=TESTKEY in de URL testen.',
        debug: { fromISO, toISO, windowDays }
      })
    }

    const rows: Row[] = []

    await Promise.all(INDICATORS.map(async ind => {
      try {
        const relId = await getReleaseIdForSeries(apiKey, ind.seriesId)
        if (!relId) return
        const dates = await getFutureReleaseDates(apiKey, relId, fromISO, toISO)
        const fredReleaseUrl = `https://fred.stlouisfed.org/release?rid=${relId}`
        dates.forEach(d => rows.push({
          dateISO: d,
          dateLabel: nl(d),
          event: ind.name,
          impact: ind.impact,
          region: ind.region || REGION,
          sourceUrl: fredReleaseUrl,
        }))
      } catch {
        // skip this indicator on error
      }
    }))

    rows.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0))

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600')
    return res.status(200).json({
      items: rows,
      hint: `FRED release calendar · ${rows.length} events · window=${windowDays}d`,
      debug: { fromISO, toISO, windowDays }
    })
  } catch (e: any) {
    return res.status(200).json({
      items: [],
      hint: 'FRED fetch failed',
      detail: String(e?.message || e)
    })
  }
}