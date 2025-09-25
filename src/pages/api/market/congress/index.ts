// src/pages/api/market/congress/index.ts
import type { NextApiRequest, NextApiResponse } from 'next'

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

export const config = { runtime: 'nodejs' }

// ----- utils -----
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
    (raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/) ? raw.slice(0,10) : (
      isNaN(new Date(raw).getTime()) ? null : new Date(raw).toISOString().slice(0,10)
    ))
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

// --- Vercel/Chromium + Puppeteer launch (type-compatibel) ---
async function getBrowser() {
  if (process.env.VERCEL || process.env.AWS_REGION) {
    // Veilige any-cast zodat typings je build niet breken
    const mod: any = await import('@sparticuz/chromium')
    const chromium: any = mod?.default ?? mod
    const puppeteer = await import('puppeteer-core')

    const browser = await puppeteer.default.launch({
      args: [
        ...(chromium?.args ?? []),
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
      ],
      defaultViewport: chromium?.defaultViewport ?? null,
      executablePath: await (chromium?.executablePath?.() ?? Promise.resolve('/usr/bin/chromium')),
      headless: true, // expliciet boolean
    })
    return { browser }
  } else {
    const { default: puppeteer } = await import('puppeteer')
    const browser = await puppeteer.launch({ headless: true } as any)
    return { browser }
  }
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

// ----- handler -----
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const limitQ = Number(req.query.limit)
  const limit = Number.isFinite(limitQ) ? Math.min(Math.max(limitQ, 1), 100) : 25

  let browser: any
  try {
    const { browser: b } = await getBrowser()
    browser = b
    const page = await browser.newPage()
    await page.setViewport({ width: 1480, height: 1200, deviceScaleFactor: 1 })
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    )

    const out: Item[] = []
    let pageNum = 1

    while (out.length < limit && pageNum <= 6) {
      const url = `https://www.capitoltrades.com/trades?page=${pageNum}&sort=-transaction_date`
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 })

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

          // Side/Type (BUY/SELL). Probeer eerst expliciete kolom:
          let sideRaw = ''
          if (idxType >= 0) sideRaw = getCell(tr, idxType)

          // Fallback: badge/tekst in de hele rij
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

        // reconstruct traded via "Filed After" indien nodig
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

    // newest first
    out.sort((a, b) => {
      const tA = new Date(a.publishedISO || a.tradedISO || 0).getTime()
      const tB = new Date(b.publishedISO || b.tradedISO || 0).getTime()
      return tB - tA
    })

    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=600')
    return res.status(200).json({
      items: out.slice(0, limit),
      hint: 'CapitolTrades scrape (Published/Traded/Size/Price + BUY/SELL; viewport-wide + filed-after fallback)',
    })
  } catch (e: any) {
    return res.status(502).json({ items: [], hint: 'Headless scrape failed', detail: String(e?.message || e) })
  } finally {
    try { await browser?.close() } catch {}
  }
}