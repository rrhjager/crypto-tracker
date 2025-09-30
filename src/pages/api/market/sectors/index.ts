// src/pages/api/market/sectors/index.ts
import type { NextApiRequest, NextApiResponse } from 'next'

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

const SYMBOLS = Object.keys(MAP) // ['XLE','XLF',...]

const G: any = globalThis as any
if (!G.__SECTORS_CACHE__) {
  // eenvoudige in-memory cache (5 min)
  G.__SECTORS_CACHE__ = { ts: 0, data: null as null | SectorRow[] }
}

function pct(a?: number | null, b?: number | null) {
  if (!a || !b || !isFinite(a) || !isFinite(b)) return null
  return ((a / b) - 1) * 100
}

async function fetchStooqCSV(sym: string) {
  // dag-interval CSV; .us suffix is vereist voor US tickers
  const url = `https://stooq.com/q/d/l/?s=${sym.toLowerCase()}.us&i=d`
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`)
  const txt = await r.text()
  // CSV: Date,Open,High,Low,Close,Volume
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
  const last = arr[arr.length - 1].date // yyyy-mm-dd
  const year = Number(last.slice(0,4))
  // eerste handelsdag van dit jaar: zoek eerste rij met zelfde jaar
  const i = arr.findIndex(r => Number(r.date.slice(0,4)) === year)
  return i >= 0 ? arr[i].close : null
}

async function buildOne(sym: string): Promise<SectorRow> {
  const series = await fetchStooqCSV(sym)
  if (series.length < 2) {
    return { code: sym, sector: MAP[sym], close: null }
  }

  const lastClose = takeCloseAtOffset(series, 0)
  const prevClose = takeCloseAtOffset(series, 1)
  const wClose   = takeCloseAtOffset(series, 5)   // ~1 week (5 handelsdagen)
  const mClose   = takeCloseAtOffset(series, 21)  // ~1 maand
  const m3Close  = takeCloseAtOffset(series, 63)  // ~3 maanden
  const y1Close  = takeCloseAtOffset(series, 252) // ~1 jaar
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // cache 5 min
  const TTL = 5 * 60 * 1000
  if (G.__SECTORS_CACHE__.data && (Date.now() - G.__SECTORS_CACHE__.ts) < TTL) {
    return res.status(200).json({ items: G.__SECTORS_CACHE__.data, source: 'stooq-cache' })
  }

  try {
    // fetch sequentieel om rate-limits te vermijden (Stooq is snel)
    const out: SectorRow[] = []
    for (const s of SYMBOLS) {
      try {
        out.push(await buildOne(s))
        // kleine delay om beleefd te zijn
        await new Promise(r => setTimeout(r, 120))
      } catch (e: any) {
        out.push({ code: s, sector: MAP[s], close: null })
      }
    }

    // sorteer op dagrendement desc (als aanwezig)
    out.sort((a, b) => ( (b.d1 ?? -999) - (a.d1 ?? -999) ))

    G.__SECTORS_CACHE__ = { ts: Date.now(), data: out }
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1200')
    return res.status(200).json({ items: out, source: 'stooq' })
  } catch (e: any) {
    return res.status(502).json({ items: [], hint: 'Sectors from Stooq failed', detail: String(e?.message || e) })
  }
}