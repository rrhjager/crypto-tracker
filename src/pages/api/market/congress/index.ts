import type { NextApiRequest, NextApiResponse } from 'next'
import { kvRefreshIfStale, kvSetJSON, kvGetJSON } from '@/lib/kv'

// Zorg voor Node runtime (puppeteer werkt niet op edge)
export const config = { runtime: 'nodejs', maxDuration: 60 }

type Item = {
  publishedISO: string | null
  publishedLabel: string
  tradedISO: string | null
  tradedLabel: string
  person: string
  ticker: string
  amount: string
  price: string
  side: 'BUY' | 'SELL' | '—'
}

/* ---------------- Cache-instellingen ---------------- */
// Edge CDN: snelle TTFB en weinig function hits
const EDGE_S_MAXAGE = 900;   // 15 min
const EDGE_SWR      = 3600;  // 60 min
// KV snapshot: 60 min geldig; 5 min ervoor revalidate
const KV_TTL_SEC    = 3600;  // 60 min
const KV_REVALIDATE = 300;   // 5 min vóór TTL

/* ---------------- utils ---------------- */
const monthMap: Record<string, number> = {
  jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5,
  jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, sept:9, september:9,
  oct:10, october:10, nov:11, november:11, dec:12, december:12,
}
function parseDayMonthYear(txt?: string | null): string | null {
  if (!txt) return null
  const m = txt.trim().match(/^(\d{1,2})\s+([A-Za-z\.]+)\s+(\d{4})$/)
  if (!m) return null
  const dd = String(parseInt(m[1],10)).padStart(2,'0')
  const mmn = monthMap[m[2].replace('.','').toLowerCase()]
  if (!mmn) return null
  const mm = String(mmn).padStart(2,'0')
  return `${m[3]}-${mm}-${dd}`
}
function toISO(raw?: string | null): string | null {
  if (!raw) return null
  return (
    parseDayMonthYear(raw) ||
    (raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/) ? raw.slice(0,10) :
      (isNaN(new Date(raw).getTime()) ? null : new Date(raw).toISOString().slice(0,10))
    )
  )
}
const nl = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('nl-NL', { day:'2-digit', month:'short', year:'numeric' }) : '—'

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0,10)
}
function subDaysISO(iso: string, days: number): string {
  return addDaysISO(iso, -days)
}

function normalizeSide(s?: string | null): 'BUY' | 'SELL' | '—' {
  const t = (s || '').toLowerCase()
  if (!t) return '—'
  const isBuy  = /\b(buy|purchase|acquisition|acquire|bought)\b/.test(t)
  const isSell = /\b(sell|sale|disposal|dispose|sold)\b/.test(t)
  if (isBuy && !isSell) return 'BUY'
  if (isSell && !isBuy) return 'SELL'
  return '—'
}

/* -------- Headless Chromium (met databesparing) -------- */
async function getBrowser() {
  if (process.env.VERCEL || process.env.AWS_REGION) {
    const { default: chromium } = await import('@sparticuz/chromium')
    const puppeteer = await import('puppeteer-core')
    const chr = chromium as unknown as {
      args?: string[]
      defaultViewport?: any
      executablePath: () => Promise<string>
      headless?: unknown
    }
    const headlessOpt: boolean = typeof chr.headless === 'boolean' ? (chr.headless as boolean) : true
    const browser = await puppeteer.default.launch({
      args: [
        ...(chr.args ?? []),
        // Minder data: blokkeer extensies, GPU, etc.
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-setuid-sandbox',
        '--no-sandbox'
      ],
      defaultViewport: chr.defaultViewport ?? null,
      executablePath: await chr.executablePath(),
      headless: headlessOpt,
    })
    return browser
  } else {
    const { default: puppeteer } = await import('puppeteer')
    return puppeteer.launch({ headless: true } as any)
  }
}

// Promise timeout helper
function withTimeout<T>(p: Promise<T>, ms: number, msg = 'timeout'): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

// Abort/skip zware assets om data te besparen
async function enableNetworkThrift(page: any) {
  // Puppeteer v20+: page.route; oudere: setRequestInterception
  if (page.route) {
    await page.route('**/*', (route: any) => {
      const req = route.request()
      const type = req.resourceType()
      // blokkeer media/beelden/fonts/CSS/3rd-party analytics
      const url = req.url()
      const is3p = /google-analytics|googletagmanager|facebook|twitter|doubleclick|adservice|hotjar|segment|mixpanel|sentry|cloudflareinsights/i.test(url)
      if (['image','media','font','stylesheet'].includes(type) || is3p) {
        return route.abort()
      }
      return route.continue()
    })
  } else {
    await page.setRequestInterception(true)
    page.on('request', (req: any) => {
      const type = req.resourceType()
      const url = req.url()
      const is3p = /google-analytics|googletagmanager|facebook|twitter|doubleclick|adservice|hotjar|segment|mixpanel|sentry|cloudflareinsights/i.test(url)
      if (['image','media','font','stylesheet'].includes(type) || is3p) {
        req.abort()
      } else {
        req.continue()
      }
    })
  }
}

/* ---------------- scrape core ---------------- */
async function scrape(limit: number): Promise<Item[]> {
  const browser = await withTimeout(getBrowser(), 25_000, 'browser timeout')
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1366, height: 1024, deviceScaleFactor: 1 })
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    )

    // Grote besparing: blokkeer zware assets
    await enableNetworkThrift(page)

    const out: Item[] = []
    let pageNum = 1

    while (out.length < limit && pageNum <= 5) {
      const url = `https://www.capitoltrades.com/trades?page=${pageNum}&sort=-transaction_date`
      await withTimeout(page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }), 50_000, 'goto timeout')

      // wacht kort tot tabel DOM klaar is
      await page.waitForSelector('table tbody tr', { timeout: 10_000 }).catch(() => {})

      const rows = await page.evaluate(() => {
        const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim()

        const headers = Array.from(document.querySelectorAll('table thead th')).map(th =>
          (th.textContent || '').trim().toLowerCase()
        )

        const idxPolitician = headers.findIndex(h => h.includes('politician'))
        const idxIssuer     = headers.findIndex(h => h.includes('traded issuer') || h.includes('issuer') || h.includes('stock'))
        const idxPublished  = headers.findIndex(h => h.includes('published'))
        const idxTraded     = headers.findIndex(h => h.includes('traded'))
        const idxFiledAfter = headers.findIndex(h => h.includes('filed after'))
        const idxSize       = headers.findIndex(h => h.includes('size'))
        const idxPrice      = headers.findIndex(h => h.includes('price'))
        const idxType       = headers.findIndex(h => h.includes('transaction') || h.includes('type') || h.includes('side') || h.includes('direction'))

        const getCell = (tr: HTMLTableRowElement, idx: number) =>
          clean(tr.querySelectorAll('td')[idx]?.textContent || '')

        const data: Array<{
          person: string
          issuerCell: string
          publishedText: string
          tradedText: string
          filedAfterDays: number | null
          sizeText: string
          priceText: string
          sideRaw: string
        }> = []

        document.querySelectorAll('table tbody tr').forEach(trEl => {
          const tr = trEl as HTMLTableRowElement

          const person =
            clean(tr.querySelector('a[href*="/politicians/"]')?.textContent) ||
            (idxPolitician >= 0 ? getCell(tr, idxPolitician) : '')

          const issuerCell = idxIssuer >= 0 ? getCell(tr, idxIssuer) : ''
          const publishedText = idxPublished >= 0 ? getCell(tr, idxPublished) : ''
          const tradedText    = idxTraded    >= 0 ? getCell(tr, idxTraded)    : ''

          let filedAfterDays: number | null = null
          if (idxFiledAfter >= 0) {
            const t = getCell(tr, idxFiledAfter) // e.g. "34 days"
            const m = t.match(/(\d+)\s*day/i)
            filedAfterDays = m ? parseInt(m[1], 10) : null
          }

          let sizeText = ''
          if (idxSize >= 0) {
            const t = getCell(tr, idxSize)
            const badge = t.match(/\b\d+(?:\.\d+)?[Kk](?:\s*[–-]\s*\d+(?:\.\d+)?[Kk]|\+)?\b/)
            sizeText = badge ? badge[0].toUpperCase() : t
          }

          let priceText = ''
          if (idxPrice >= 0) {
            const t = getCell(tr, idxPrice)
            const m = t.match(/\$[\d,]+(?:\.\d{1,2})?/) || t.match(/N\/A/i)
            priceText = m ? m[0] : t
          }

          // Side/Type
          let sideRaw = ''
          if (idxType >= 0) sideRaw = getCell(tr, idxType)
          if (!sideRaw) {
            const whole = clean(tr.textContent || '')
            const m = whole.match(/\b(buy|purchase|acquisition|acquire|sold|sell|sale|disposal|dispose)\b/i)
            sideRaw = m ? m[0] : ''
          }

          if (person || issuerCell) {
            data.push({ person, issuerCell, publishedText, tradedText, filedAfterDays, sizeText, priceText, sideRaw })
          }
        })

        return data
      })

      for (const r of rows) {
        const pubISO = toISO(r.publishedText as any)
        let trdISO = toISO(r.tradedText as any)
        if (!trdISO && pubISO && r.filedAfterDays != null && r.filedAfterDays >= 0) {
          trdISO = subDaysISO(pubISO, r.filedAfterDays)
        }

        const ticker = r.issuerCell || '—'
        const side = normalizeSide(r.sideRaw)

        out.push({
          publishedISO: pubISO,
          publishedLabel: nl(pubISO),
          tradedISO: trdISO,
          tradedLabel: nl(trdISO),
          person: r.person || '—',
          ticker,
          amount: r.sizeText || '—',
          price: r.priceText || '—',
          side,
        })
        if (out.length >= limit) break
      }

      pageNum++
    }

    out.sort((a, b) => {
      const tA = new Date(a.publishedISO || a.tradedISO || 0).getTime()
      const tB = new Date(b.publishedISO || b.tradedISO || 0).getTime()
      return tB - tA
    })

    await page.close()
    return out.slice(0, limit)
  } finally {
    try { await browser?.close() } catch {}
  }
}

/* ---------------- handler ---------------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const limitQ = Number(req.query.limit)
  const limit = Number.isFinite(limitQ) ? Math.min(Math.max(limitQ, 1), 100) : 25
  const force = String(req.query.force || '') === '1'
  const CACHE_KEY = `congress:v2:${limit}`

  // CDN hints: snelle TTFB en SWR op de edge
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_S_MAXAGE}, stale-while-revalidate=${EDGE_SWR}`)

  // force=1 → altijd fresh scrape + cache (debug)
  if (force) {
    try {
      const fresh = await scrape(limit)
      try { await kvSetJSON(CACHE_KEY, { items: fresh, updatedAt: Date.now() }, KV_TTL_SEC) } catch {}
      return res.status(200).json({ items: fresh, hint: 'Fresh scrape (force=1)' })
    } catch (e: any) {
      const staleAny = await kvGetJSON<any>(CACHE_KEY)
      const staleItems: Item[] = Array.isArray(staleAny) ? staleAny : (staleAny?.items || [])
      if (staleItems?.length) {
        return res.status(200).json({ items: staleItems, hint: 'Stale cache (scrape failed with force=1)' })
      }
      return res.status(502).json({ items: [], hint: 'Scrape failed (force=1)', detail: String(e?.message || e) })
    }
  }

  try {
    // Serve KV; vlak vóór TTL in bg verversen (goedkoop)
    const snap = await kvRefreshIfStale<{ items: Item[]; updatedAt: number }>(
      CACHE_KEY,
      KV_TTL_SEC,
      KV_REVALIDATE,
      async () => {
        const items = await scrape(limit)
        const payload = { items, updatedAt: Date.now() }
        try { await kvSetJSON(CACHE_KEY, payload, KV_TTL_SEC) } catch {}
        return payload
      }
    )

    if (snap?.items) {
      return res.status(200).json({ items: snap.items, hint: 'KV snapshot (SWR refresh)' })
    }

    // Eerste keer: fresh + store
    const items = await scrape(limit)
    try { await kvSetJSON(CACHE_KEY, { items, updatedAt: Date.now() }, KV_TTL_SEC) } catch {}
    return res.status(200).json({ items, hint: 'Fresh fill' })
  } catch (e: any) {
    // laatste redmiddel: stale proberen
    const staleAny = await kvGetJSON<any>(CACHE_KEY)
    const staleItems: Item[] = Array.isArray(staleAny) ? staleAny : (staleAny?.items || [])
    if (staleItems?.length) {
      return res.status(200).json({ items: staleItems, hint: 'Stale cache (fresh failed)' })
    }
    return res.status(502).json({ items: [], hint: 'Headless scrape failed', detail: String(e?.message || e) })
  }
}