// src/pages/intel/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type Row = {
  publishedISO?: string | null
  publishedLabel: string
  person: string
  ticker: string            // bevat issuer + evt. symbool, bv. "Company MSFT:US"
  amount: string            // "1K–15K", "250K–500K", "N/A"
  price: string             // "$192.76" of "N/A"
  side?: 'BUY' | 'SELL' | string | null
}

// — helpers —
function splitIssuer(raw?: string) {
  const t = (raw || '').trim()
  if (!t) return { company: '—', symbol: '' }
  const m = t.match(/([A-Z]{1,6}:[A-Z]{2,3})$/)
  if (m) {
    const symbol = m[1]
    const company = t.slice(0, t.length - symbol.length).trim() || '—'
    return { company, symbol }
  }
  if (t.endsWith('N/A')) {
    const company = t.replace(/N\/A\s*$/, '').trim() || '—'
    return { company, symbol: '' }
  }
  return { company: t, symbol: '' }
}

function tradingViewUrl(symbol?: string) {
  if (!symbol) return null
  const core = symbol.split(':')[0]?.replace(/[^A-Z0-9_.-]/gi, '')
  return core ? `https://www.tradingview.com/symbols/${core.toUpperCase()}/` : null
}

// Koop/Verkoop badge
function inferSide(txt?: string | null, apiSide?: string | null): 'BUY' | 'SELL' | '—' {
  const s = (apiSide || '').toUpperCase().trim()
  if (s === 'BUY' || s === 'PURCHASE') return 'BUY'
  if (s === 'SELL' || s === 'SALE' || s === 'DISPOSED') return 'SELL'
  const t = (txt || '').toLowerCase()
  if (/\b(purchase|bought|acquired|buy)\b/.test(t)) return 'BUY'
  if (/\b(sale|sold|disposed|sell)\b/.test(t)) return 'SELL'
  return '—'
}

function SideBadge({ side }: { side: 'BUY' | 'SELL' | '—' }) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium'
  if (side === 'BUY') return <span className={`${base} bg-green-100 text-green-700`}>Buy</span>
  if (side === 'SELL') return <span className={`${base} bg-red-100 text-red-700`}>Sell</span>
  return <span className={`${base} bg-gray-100 text-gray-600`}>—</span>
}

/** Parse NL korte maand (bv. "18 sep 2025") → time value (ms) of NaN */
function parseDutchDate(label?: string): number {
  if (!label) return NaN
  const m = label.trim().toLowerCase().match(/^(\d{1,2})\s+([a-z]{3})\.?\s+(\d{4})$/)
  if (!m) return NaN
  const dd = Number(m[1])
  const months: Record<string, number> = {
    jan: 0, feb: 1, mrt: 2, apr: 3, mei: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, okt: 9, nov:10, dec:11,
  }
  const mm = months[m[2]]
  const yyyy = Number(m[3])
  if (mm == null) return NaN
  return new Date(Date.UTC(yyyy, mm, dd)).getTime()
}

export default function MarketIntel() {
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setErr(null); setLoading(true)
        const r = await fetch('/api/market/congress?limit=25', { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        if (!aborted) setRows(Array.isArray(j.items) ? j.items : [])
      } catch (e: any) {
        if (!aborted) setErr(String(e?.message || e))
      } finally {
        if (!aborted) setLoading(false)
      }
    })()
    return () => { aborted = true }
  }, [])

  // ▶ Sortering: nieuwste bovenaan (val terug op DOM-volgorde)
  const sorted = useMemo(() => {
    return rows
      .map((r, i) => {
        // 1) publishedISO (voorkeur)
        const tISO = r.publishedISO ? Date.parse(r.publishedISO) : NaN
        // 2) anders NL-label
        const tLabel = Number.isFinite(tISO) ? tISO : parseDutchDate(r.publishedLabel)
        return { r, i, t: tLabel }
      })
      .sort((a, b) => {
        const aHas = Number.isFinite(a.t)
        const bHas = Number.isFinite(b.t)
        if (aHas && bHas) return b.t - a.t          // beiden datum → desc
        if (aHas && !bHas) return -1                // met datum eerst
        if (!aHas && bHas) return 1
        return a.i - b.i                            // geen datum → oorspronkelijke volgorde
      })
      .map(x => x.r)
  }, [rows])

  return (
    <>
      <Head><title>Congress Trading — SignalHub</title></Head>
      <main className="min-h-screen">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <h1 className="hero">Congress Trading</h1>
          {err && <div className="mt-2 text-sm text-red-600">Fout bij laden: {err}</div>}
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16">
          <div className="table-card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-3 w-[140px]">Published</th>
                  <th className="px-4 py-3 w-[220px]">Persoon</th>
                  <th className="px-4 py-3">Ticker</th>
                  <th className="px-4 py-3 w-[90px]">Side</th>
                  <th className="px-4 py-3 w-[140px]">Bedrag</th>
                  <th className="px-4 py-3 w-[110px]">Prijs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading && (
                  <tr><td className="px-4 py-3 text-gray-500" colSpan={6}>Laden…</td></tr>
                )}
                {!loading && sorted.length === 0 && (
                  <tr><td className="px-4 py-3 text-gray-500" colSpan={6}>Geen data gevonden.</td></tr>
                )}
                {sorted.map((r, i) => {
                  const { company, symbol } = splitIssuer(r.ticker)
                  const tvUrl = tradingViewUrl(symbol)
                  const side: 'BUY' | 'SELL' | '—' = inferSide(r.ticker, r.side ?? null)

                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3">{r.publishedLabel || '—'}</td>
                      <td className="px-4 py-3">{r.person || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="leading-tight">
                          {tvUrl ? (
                            <a
                              href={tvUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-900 hover:underline"
                              title={`Open ${symbol} op TradingView`}
                            >
                              <div>{company}</div>
                              {symbol && <div className="text-[11px] text-gray-500 mt-0.5">{symbol}</div>}
                            </a>
                          ) : (
                            <>
                              <div className="text-gray-900">{company}</div>
                              {symbol && <div className="text-[11px] text-gray-500 mt-0.5">{symbol}</div>}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <SideBadge side={side} />
                      </td>
                      <td className="px-4 py-3">{r.amount || '—'}</td>
                      <td className="px-4 py-3">{r.price || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <Link href="/" className="btn">← Terug</Link>
          </div>
        </section>
      </main>
    </>
  )
}