import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'

// Draai in Node-runtime (puppeteer/edge niet nodig hier)
export const config = { runtime: 'nodejs' }

/**
 * Gratis bron: Stooq (EOD). We gebruiken SPDR Sector ETF's als proxy:
 * XLE (Energy), XLF (Financials), XLK (Tech), XLY (Cons. Disc), XLP (Cons. Staples),
 * XLI (Industrials), XLV (Health Care), XLU (Utilities), XLB (Materials),
 * XLRE (Real Estate), XLC (Comm Services).
 */

type SectorRow = {
  code: string
  sector: string
  close: number | null
  d1?: number | null
  w1?: number | null
  m1?: number | null
  m3?: number | null
  ytd?: number | null
  y1?: number | null
}

const MAP: Record<string, string> = {
  XLE: 'Energy',
  XLF: 'Financials',
  XLK: 'Information Technology',
  XLY: 'Consumer Discretionary',
  XLP: 'Consumer Staples',
  XLI: 'Industrials',
  XLV: 'Health Care',
  XLU: 'Utilities',
  XLB: 'Materials',
  XLRE: 'Real Estate',
  XLC: 'Communication Services',
}

const SYMBOLS = Object.keys(MAP)

function pct(a?: number | null, b?: number | null) {
  if (a == null || b == null) return null
  if (!isFinite(a) || !isFinite(b) || b === 0) return null
  return ((a / b) - 1) * 100
}

async function fetchStooqCSV(sym: string) {
  const url = `https://stooq.com/q/d/l/?s=${sym.toLowerCase()}.us&i=d`
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`)
  const txt = await r.text()
  const lines = txt.trim().split(/\r?\n/)
  const rows = lines.slice(1).map(line => {
    const [d, , , , c] = line.split(',')
    const close = Number(c)
    return { date: d, close: isFinite(close) ? close : NaN }
  }).filter(x => x.date && isFinite(x.close))
  return rows
}

function takeCloseAtOffset(arr: {date:string,close:number}[], offFromEnd: number) {
  const idx = arr.length - 1 - offFromEnd
  if (idx < 0 || idx >= arr.length) return null
  return arr[idx].close
}

function findYtdBase(arr: {date:string,close:number}[]) {
  if (!arr.length) return null
  const last = arr[arr.length - 1].date
  const year = Number(last.slice(0,4))
  const i = arr.findIndex(r => Number(r.date.slice(0,4)) === year)
  return i >= 0 ? arr[i].close : null
}

async function buildOne(sym: string): Promise<SectorRow> {
  const series = await fetchStooqCSV(sym)
  if (series.length < 2) return { code: sym, sector: MAP[sym], close: null }

  const lastClose = takeCloseAtOffset(series, 0)
  const prevClose = takeCloseAtOffset(series, 1)
  const wClose   = takeCloseAtOffset(series, 5)
  const mClose   = takeCloseAtOffset(series, 21)
  const m3Close  = takeCloseAtOffset(series, 63)
  const y1Close  = takeCloseAtOffset(series, 252)
  const ytdBase  = findYtdBase(series)

  return {
    code: sym,
    sector: MAP[sym],
    close: lastClose,
    d1: pct(lastClose, prevClose),
    w1: pct(lastClose, wClose),
    m1: pct(lastClose, mClose),
    m3: pct(lastClose, m3Close),
    ytd: pct(lastClose, ytdBase),
    y1: pct(lastClose, y1Close),
  }
}

// ==============================
// 🔹 Verbeterde datafunctie met parallel + rate-limit
// 🔹 Cached in KV voor 10 minuten + edge-cache 5 minuten
// ==============================
async function fetchAllSectors(): Promise<SectorRow[]> {
  const out: SectorRow[] = []
  const errors: string[] = []
  const limiter = 3 // max 3 tegelijk

  const chunks: string[][] = []
  for (let i = 0; i < SYMBOLS.length; i += limiter) {
    chunks.push(SYMBOLS.slice(i, i + limiter))
  }

  for (const group of chunks) {
    const results = await Promise.allSettled(group.map(buildOne))
    for (const [i, res] of results.entries()) {
      const sym = group[i]
      if (res.status === 'fulfilled') out.push(res.value)
      else {
        out.push({ code: sym, sector: MAP[sym], close: null })
        errors.push(`${sym}: ${res.reason}`)
      }
    }
    await new Promise(r => setTimeout(r, 100)) // mini delay
  }

  out.sort((a, b) => ((b.d1 ?? -999) - (a.d1 ?? -999)))
  return out
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const KV_KEY = 'intel:sectors:v1'
  const KV_TTL = 600   // 10 minuten
  const REVALIDATE = 120 // BG-refresh 2 minuten voor verval
  const EDGE_MAXAGE = 300 // 5 minuten CDN-cache

  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_MAXAGE}, stale-while-revalidate=900`)

  try {
    const data = await kvRefreshIfStale<SectorRow[]>(KV_KEY, KV_TTL, REVALIDATE, fetchAllSectors)
    if (!data) {
      const fresh = await fetchAllSectors()
      try { await kvSetJSON(KV_KEY, fresh, KV_TTL) } catch {}
      return res.status(200).json({ items: fresh, source: 'fresh' })
    }
    return res.status(200).json({ items: data, source: 'kv' })
  } catch (e: any) {
    return res.status(200).json({ items: [], source: 'error', detail: String(e?.message || e) })
  }
}