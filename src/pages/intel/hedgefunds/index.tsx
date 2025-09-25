// src/pages/intel/hedgefunds/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useState } from 'react'

type Holding = {
  issuer: string
  symbol: string | null        // blijft in het type voor compat – wordt niet gerenderd
  valueUSD: number | null
  shares: number | null
  class?: string | null
  cusip?: string | null
}
type Fund = {
  fund: string
  cik?: string | null
  asOf?: string | null
  filingUrl?: string | null
  holdings: Holding[]
}

export default function HedgeFunds() {
  const [items, setItems] = useState<Fund[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setErr(null); setLoading(true)
        const r = await fetch('/api/market/hedgefunds?top=12', { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        if (!aborted) setItems(Array.isArray(j.items) ? j.items : [])
      } catch (e: any) {
        if (!aborted) setErr(String(e?.message || e))
      } finally {
        if (!aborted) setLoading(false)
      }
    })()
    return () => { aborted = true }
  }, [])

  const money = (n?: number | null) =>
    Number.isFinite(n as number)
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n as number)
      : '—'

  return (
    <>
      <Head><title>Hedge Fund Holdings — SignalHub</title></Head>
      <main className="min-h-screen">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-6">
          <h1 className="hero">Hedge Fund Holdings</h1>
          {err && <div className="mt-2 text-sm text-red-600">Fout bij laden: {err}</div>}
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16 space-y-6">
          {loading && <div className="table-card p-4 text-sm text-gray-600">Laden…</div>}
          {!loading && items.length === 0 && (
            <div className="table-card p-4 text-sm text-gray-600">Geen data gevonden.</div>
          )}

          {items.map((f, idx) => (
            <div key={idx} className="table-card p-0 overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between bg-gray-50">
                <div className="font-semibold text-gray-900">
                  {f.fund}
                  {f.asOf && <span className="ml-2 text-sm text-gray-600">as of {new Date(f.asOf).toLocaleDateString('nl-NL')}</span>}
                </div>
                {f.filingUrl && (
                  <a href={f.filingUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">
                    Filing →
                  </a>
                )}
              </div>

              <table className="w-full text-sm">
                <thead className="bg-white">
                  <tr className="text-left text-gray-500">
                    <th className="px-4 py-3">Issuer</th>
                    {/* Symbol kolom verwijderd */}
                    <th className="px-4 py-3">Class</th>
                    <th className="px-4 py-3">CUSIP</th>
                    <th className="px-4 py-3 text-right">Shares</th>
                    <th className="px-4 py-3 text-right">Value (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {f.holdings.map((h, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">{h.issuer || '—'}</td>
                      {/* Symbol cel verwijderd */}
                      <td className="px-4 py-3">{h.class || '—'}</td>
                      <td className="px-4 py-3">{h.cusip || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        {Number.isFinite(h.shares as number) ? (h.shares as number).toLocaleString('en-US') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">{money(h.valueUSD)}</td>
                    </tr>
                  ))}
                  {f.holdings.length === 0 && (
                    <tr><td className="px-4 py-3 text-gray-500" colSpan={5}>Geen holdings gevonden in laatste filing.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}

          <div className="flex gap-2">
            <Link href="/" className="btn">← Terug</Link>
          </div>
        </section>
      </main>
    </>
  )
}