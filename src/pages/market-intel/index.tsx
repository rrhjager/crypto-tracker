// src/pages/intel/index.tsx
import Head from 'next/head'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Item = {
  chamber: 'senate' | 'house'
  transactionDate?: string
  filingDate?: string
  representative?: string
  transaction?: string
  ticker?: string
  assetName?: string
  amount?: string
  link?: string
  // sommige feeds gebruiken andere namen:
  disclosureDate?: string
  reportedDate?: string
  reportedAt?: string
  date?: string
}

function chipCls(t?: string) {
  const x = (t || '').toLowerCase()
  if (x.includes('purchase') || x.includes('buy')) return 'text-green-700 bg-green-100 border-green-200'
  if (x.includes('sale') || x.includes('sell'))    return 'text-red-700 bg-red-100 border-red-200'
  return 'text-gray-700 bg-gray-100 border-gray-200'
}

/* === recency helpers === */
const TWO_DAYS_MS = 48 * 60 * 60 * 1000

// probeer een bruikbare datum te vinden in het item
function pickDateString(it: Item): string | null {
  const tried = [
    it.transactionDate,
    it.filingDate,
    it.disclosureDate,
    it.reportedDate,
    it.reportedAt,
    it.date,
  ].filter(Boolean) as string[]

  if (tried.length) return tried[0]

  // laatste redmiddel: probeer YYYY-MM-DD of YYYY/MM/DD uit de link te halen
  if (it.link) {
    const m = it.link.match(/(\d{4})[-/](\d{2})[-/](\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
  }
  return null
}

function parseTs(s?: string | null): number | null {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

function isUnderTwoDays(ts: number | null, now = Date.now()) {
  return ts != null && (now - ts) < TWO_DAYS_MS
}

function fmtDisplayDate(orig?: string | null) {
  if (!orig) return '—'
  // probeer netjes te formatteren als het ISO-achtig is; anders laat de bronstring staan
  const t = Date.parse(orig)
  if (Number.isFinite(t)) {
    try {
      return new Date(t).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
    } catch { /* fallthrough */ }
  }
  return orig
}

export default function CongressTradingPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [chamber, setChamber] = useState<'both' | 'senate' | 'house'>('both')
  const [symbol, setSymbol] = useState('')

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setLoading(true); setErr(null)
        const qs = new URLSearchParams()
        if (chamber !== 'both') qs.set('chamber', chamber)
        if (symbol.trim()) qs.set('symbol', symbol.trim().toUpperCase())
        const r = await fetch(`/api/market/congress?${qs.toString()}`, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json() as { items: Item[] }
        if (!aborted) setItems(j.items || [])
      } catch (e: any) {
        if (!aborted) setErr(String(e?.message || e))
      } finally {
        if (!aborted) setLoading(false)
      }
    })()
    return () => { aborted = true }
  }, [chamber, symbol])

  const rows = useMemo(() => (items || []).slice(0, 200), [items])

  // “now” ticker zodat labels vanzelf omslaan
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000) // elke minuut
    return () => clearInterval(id)
  }, [])

  // verrijk + sorteer: verse eerst, daarbinnen nieuwste eerst; daarna rest op datum
  const sortedRows = useMemo(() => {
    const mapped = rows.map((r) => {
      const dateStr = pickDateString(r)
      const ts = parseTs(dateStr)
      const fresh = isUnderTwoDays(ts, now)
      const display = fresh ? '> 2 days ago' : fmtDisplayDate(dateStr)
      return { ...r, _ts: ts ?? 0, _fresh: fresh, _displayDate: display }
    })

    return mapped.sort((a: any, b: any) => {
      if (a._fresh !== b._fresh) return a._fresh ? -1 : 1 // verse bovenaan
      return (b._ts || 0) - (a._ts || 0)                  // nieuwste eerst
    })
  }, [rows, now])

  return (
    <>
      <Head><title>Congress Trading — SignalHub</title></Head>
      <main className="min-h-screen">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <h1 className="hero">Congress Trading</h1>
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16 grid lg:grid-cols-[2fr_1fr] gap-4">
          {/* Left: table */}
          <div className="table-card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setChamber('both')}
                  className={`px-3 py-1.5 rounded-full text-sm border ${chamber==='both'?'bg-gray-900 text-white border-gray-900':'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                >All</button>
                <button
                  onClick={() => setChamber('senate')}
                  className={`px-3 py-1.5 rounded-full text-sm border ${chamber==='senate'?'bg-indigo-600 text-white border-indigo-600':'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                >Senate</button>
                <button
                  onClick={() => setChamber('house')}
                  className={`px-3 py-1.5 rounded-full text-sm border ${chamber==='house'?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                >House</button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  className="px-3 py-1.5 rounded-xl border border-gray-300 text-sm"
                  placeholder="Filter op ticker (bv. AAPL)"
                  value={symbol}
                  onChange={e => setSymbol(e.target.value)}
                />
              </div>
            </div>

            {err && <div className="px-4 py-3 text-sm text-red-600 border-b border-gray-100">Kon data niet laden: {err}</div>}

            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-3">Datum</th>
                  <th className="px-4 py-3">Persoon</th>
                  <th className="px-4 py-3">Kamer</th>
                  <th className="px-4 py-3">Transactie</th>
                  <th className="px-4 py-3">Ticker</th>
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Bedrag</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-6 text-gray-500">Laden…</td></tr>
                ) : sortedRows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-6 text-gray-500">Geen resultaten.</td></tr>
                ) : sortedRows.map((it: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">
                      {it._displayDate}
                    </td>
                    <td className="px-4 py-3 text-gray-900">{it.representative || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 rounded-full border text-gray-700 bg-gray-100 border-gray-200">
                        {it.chamber === 'senate' ? 'Senate' : 'House'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full border ${chipCls(it.transaction)}`}>
                        {it.transaction || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{it.ticker || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{it.assetName || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{it.amount || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {it.link ? (
                        <a className="text-blue-600 hover:underline" href={it.link} target="_blank" rel="noreferrer">bron</a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Right: context/CTA (ongewijzigd) */}
          <aside className="space-y-3 lg:sticky lg:top-16 h-max">
            <div className="table-card p-4">
              <div className="font-semibold text-gray-900 mb-1">Wat is dit?</div>
              <p className="text-sm text-gray-600">
                Overzicht van recente transacties gerapporteerd door leden van het U.S. Congress
                (Senate &amp; House), samengevoegd via de FMP API. Filter op ticker of kamer.
              </p>
              <div className="mt-3 text-sm text-gray-600">
                Bron: Financial Modeling Prep — endpoints “senate-trading” en “house-trading”.
              </div>
            </div>

            <div className="table-card p-4">
              <div className="font-semibold text-gray-900 mb-2">Snel naar</div>
              <div className="flex flex-wrap gap-2">
                <Link href="/stocks" className="btn">AEX</Link>
                <Link href="/sp500" className="btn">S&amp;P 500</Link>
                <Link href="/nasdaq" className="btn">NASDAQ</Link>
              </div>
            </div>
          </aside>
        </section>
      </main>
    </>
  )
}