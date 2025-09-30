// src/pages/api/market/sectors/index.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import withCache, { kvGetJSON, kvSetJSON } from '@/lib/kv'

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

/* ---------------- In-memory cache (per instance) ---------------- */
const G: any = globalThis as any
if (!G.__SECTORS_MEM__) {
  G.__SECTORS_MEM__ = { ts: 0, data: null as SectorRow[] | null }
}
// 5 min in-memory (super snel voor hot instances)
const MEM_TTL_MS = 5 * 60 * 1000
// 30 min gedeeld via KV (EOD data – prima om langer te cachen)
const KV_TTL_SEC = 30 * 60
const KV_KEY = 'sectors:v2:stooq-eod'

// helpers
function pct(a?: number | null, b?: number | null) {
  if (a == null || b == null) return null
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null
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
    return { date: d, close: Number.isFinite(close) ? close : NaN }
  }).filter(x => x.date && Number.isFinite(x.close))
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

async function buildAll(): Promise<SectorRow[]> {
  // Parallel, maar met kleine pauze om beleefd te blijven
  const out: SectorRow[] = []
  for (const s of SYMBOLS) {
    try {
      out.push(await buildOne(s))
      await new Promise(r => setTimeout(r, 80))
    } catch {
      out.push({ code: s, sector: MAP[s], close: null })
    }
  }
  out.sort((a, b) => ( (b.d1 ?? -999) - (a.d1 ?? -999) ))
  return out
}

/* ---------------- handler ---------------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const force = String(req.query.force || '') === '1'
  const debug = String(req.query.debug || '') === '1'

  // 1) ultrasnel: memory cache
  if (!force && G.__SECTORS_MEM__.data && (Date.now() - G.__SECTORS_MEM__.ts) < MEM_TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600')
    return res.status(200).json({
      items: G.__SECTORS_MEM__.data,
      source: 'memory',
      ...(debug ? { meta: { memAgeSec: Math.round((Date.now()-G.__SECTORS_MEM__.ts)/1000) } } : {})
    })
  }

  // 2) probeer gedeelde KV cache
  if (!force) {
    const kvData = await kvGetJSON<SectorRow[]>(KV_KEY)
    if (kvData?.length) {
      // hydrate memory cache voor volgende hits
      G.__SECTORS_MEM__ = { ts: Date.now(), data: kvData }
      res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=900')
      return res.status(200).json({
        items: kvData,
        source: 'kv',
        ...(debug ? { meta: { kvKey: KV_KEY } } : {})
      })
    }
  }

  // 3) fresh build (of force)
  try {
    // met KV wrapper die no-ops als KV ontbreekt
    const items = force
      ? await buildAll()
      : await withCache<SectorRow[]>(KV_KEY, KV_TTL_SEC, async () => await buildAll())

    // update memory cache
    G.__SECTORS_MEM__ = { ts: Date.now(), data: items }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1200')
    return res.status(200).json({
      items,
      source: force ? 'fresh(force)' : 'fresh-or-kvfill',
      ...(debug ? { meta: { kvKey: KV_KEY } } : {})
    })
  } catch (e: any) {
    // laatste redmiddel: toch kijken of er nog KV stale staat
    const stale = await kvGetJSON<SectorRow[]>(KV_KEY)
    if (stale?.length) {
      G.__SECTORS_MEM__ = { ts: Date.now(), data: stale }
      res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=900')
      return res.status(200).json({
        items: stale,
        source: 'kv-stale',
        hint: 'Fresh build failed; served stale KV cache.'
      })
    }
    return res.status(502).json({ items: [], hint: 'Sectors from Stooq failed', detail: String(e?.message || e) })
  }
}