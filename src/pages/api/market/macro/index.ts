import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'

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

// === Cache-instellingen (goedkoop én snel) ===
const EDGE_S_MAXAGE   = 900;   // 15 min CDN (edge) cache
const EDGE_SWR        = 3600;  // 60 min stale-while-revalidate op CDN
const KV_TTL_SEC      = 3600;  // 60 min KV snapshot per venster
const KV_REVALIDATE   = 300;   // 5 min vóór TTL achtergrond refresh
const FETCH_TIMEOUT   = 12000; // 12s budget voor alle upstream calls

const iso = (d: Date) => d.toISOString().slice(0,10)
const nl = (isoStr: string) =>
  new Date(isoStr + 'T00:00:00Z').toLocaleDateString('nl-NL', { day:'2-digit', month:'short', year:'numeric' })

function compact<T>(o: T): T {
  // strip undefined voor kleinere JSON (scheelt egress)
  return JSON.parse(JSON.stringify(o)) as T
}

async function fetchJSON(url: string, signal?: AbortSignal) {
  const r = await fetch(url, { cache: 'no-store', signal })
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`)
  return r.json()
}

async function getReleaseIdForSeries(apiKey: string, seriesId: string, signal?: AbortSignal): Promise<number | null> {
  const u = `${FRED_BASE}/series/release?series_id=${encodeURIComponent(seriesId)}&api_key=${apiKey}&file_type=json`
  const j = await fetchJSON(u, signal)
  const rel = (Array.isArray(j?.releases) ? j.releases[0] : j?.release) || null
  return (rel && typeof rel.id === 'number') ? rel.id : null
}

async function getFutureReleaseDates(apiKey: string, releaseId: number, fromISO: string, toISO: string, signal?: AbortSignal): Promise<string[]> {
  const paths = ['release/dates', 'releases/dates']
  const paramsVariants = [
    `start=${fromISO}&end=${toISO}`,
    `realtime_start=${fromISO}&realtime_end=${toISO}`,
  ]
  for (const p of paths) {
    for (const q of paramsVariants) {
      try {
        const url = `${FRED_BASE}/${p}?release_id=${releaseId}&include_release_dates_with_no_data=true&${q}&api_key=${apiKey}&file_type=json&limit=1000`
        const j = await fetchJSON(url, signal)
        const arr = Array.isArray(j?.release_dates) ? j.release_dates : []
        const out = arr
          .map((x: any) => String(x?.date || '').slice(0,10))
          .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
          .filter((d: string) => d >= fromISO && d <= toISO)
        if (out.length) return out
      } catch {
        // probeer volgende variant
      }
    }
  }
  return []
}

/** Bouwt de kalender; zelfde logica, maar met timeout + parallel begrensd */
async function computeMacroCalendar(apiKey: string, windowDays: number, fromISO: string, toISO: string) {
  const rows: Row[] = []
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT)

  // parallel, maar bounded (max 4 tegelijk om API beleefd te houden)
  const pool = 4
  let idx = 0
  const worker = async () => {
    while (idx < INDICATORS.length) {
      const i = idx++
      const ind = INDICATORS[i]
      try {
        const relId = await getReleaseIdForSeries(apiKey, ind.seriesId, ctrl.signal)
        if (!relId) continue
        const dates = await getFutureReleaseDates(apiKey, relId, fromISO, toISO, ctrl.signal)
        const fredReleaseUrl = `https://fred.stlouisfed.org/release?rid=${relId}`
        for (const d of dates) {
          rows.push({
            dateISO: d,
            dateLabel: nl(d),
            event: ind.name,
            impact: ind.impact,
            region: ind.region || REGION,
            sourceUrl: fredReleaseUrl,
          })
        }
      } catch {
        // sla deze indicator over bij fout/timeout
      }
    }
  }
  await Promise.all(new Array(Math.min(pool, INDICATORS.length)).fill(0).map(worker))
  clearTimeout(to)

  // DEDUPE + sorteer (zoals je had)
  const seen = new Set<string>()
  const uniq: Row[] = []
  for (const r of rows) {
    const key = `${r.event}__${r.dateISO}`
    if (seen.has(key)) continue
    seen.add(key)
    uniq.push(r)
  }
  uniq.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0))
  return compact(uniq)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Edge cache: meeste hits raken je functie niet eens
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_S_MAXAGE}, stale-while-revalidate=${EDGE_SWR}`)

  try {
    const apiKey = String(req.query.apiKey || process.env.FRED_API_KEY || '')
    const daysQ = Number(req.query.days)
    const windowDays = Number.isFinite(daysQ) ? Math.min(Math.max(daysQ, 7), 180) : 120

    const now = new Date()
    const fromISO = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())))
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    to.setUTCDate(to.getUTCDate() + windowDays)
    const toISO = iso(to)

    // Geen API key → zelfde nette 200 response als eerder (UI breekt niet)
    if (!apiKey) {
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({
        items: [],
        hint: 'FRED_API_KEY ontbreekt (zet in Vercel env). Eventueel tijdelijk testen met ?apiKey=... aan de URL.',
        debug: { fromISO, toISO, windowDays },
      })
    }

    // KV key per venster (key onafhankelijk van apiKey; data is gelijk bij geldige key)
    const KV_KEY = `macro:v2:${fromISO}:${toISO}`

    // Haal uit KV, of reken & zet weg. kvRefreshIfStale zorgt voor goedkope BG-refresh.
    const snapshot = await kvRefreshIfStale<{ items: Row[]; updatedAt: number }>(
      KV_KEY,
      KV_TTL_SEC,
      KV_REVALIDATE,
      async () => {
        const items = await computeMacroCalendar(apiKey, windowDays, fromISO, toISO)
        const fresh = { items, updatedAt: Date.now() }
        try { await kvSetJSON(KV_KEY, fresh, KV_TTL_SEC) } catch {}
        return fresh
      }
    )

    // Serve resultaat (uit KV of frisch berekend)
    const out = snapshot ?? { items: [], updatedAt: Date.now() }
    return res.status(200).json({
      items: out.items,
      hint: `FRED release calendar · ${out.items.length} events · window=${windowDays}d (${snapshot ? 'kv' : 'fresh'})`,
      debug: { fromISO, toISO, windowDays },
    })
  } catch (e: any) {
    return res.status(200).json({
      items: [],
      hint: 'FRED fetch failed',
      detail: String(e?.message || e),
    })
  }
}