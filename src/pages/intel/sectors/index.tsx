// src/pages/intel/sectors/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useState } from 'react'

type Row = {
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

function fmtPct(x?: number | null) {
  if (x == null || !isFinite(x)) return '—'
  const sign = x > 0 ? '+' : ''
  return `${sign}${x.toFixed(2)}%`
}
function fmtPrice(x?: number | null) {
  if (x == null || !isFinite(x)) return '—'
  return `$${x.toFixed(2)}`
}

export default function SectorPerformance() {
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setErr(null); setLoading(true)
        const r = await fetch('/api/market/sectors', { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        if (!aborted) setRows(Array.isArray(j.items) ? j.items : [])
      } catch (e:any) {
        if (!aborted) setErr(String(e?.message || e))
      } finally {
        if (!aborted) setLoading(false)
      }
    })()
    return () => { aborted = true }
  }, [])

  return (
    <>
      <Head><title>Sector performance — SignalHub</title></Head>
      <main className="min-h-screen text-gray-900 dark:text-slate-100">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <h1 className="hero">Sector performance</h1>
          {err && (
            <div className="mt-2 text-sm text-red-600 dark:text-red-400">
              Fout bij laden: {err}
            </div>
          )}
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16">
          <div className="table-card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-950/70 border-b border-gray-200 dark:border-white/10">
                <tr className="text-left text-gray-500 dark:text-slate-200">
                  <th className="px-4 py-3">Sector</th>
                  <th className="px-4 py-3 w-[80px]">ETF</th>
                  <th className="px-4 py-3 w-[90px]">Close</th>
                  <th className="px-4 py-3 w-[90px]">1D</th>
                  <th className="px-4 py-3 w-[90px]">1W</th>
                  <th className="px-4 py-3 w-[90px]">1M</th>
                  <th className="px-4 py-3 w-[90px]">3M</th>
                  <th className="px-4 py-3 w-[90px]">YTD</th>
                  <th className="px-4 py-3 w-[90px]">1Y</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {loading && (
                  <tr>
                    <td
                      className="px-4 py-3 text-gray-500 dark:text-slate-400"
                      colSpan={9}
                    >
                      Laden…
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td
                      className="px-4 py-3 text-gray-500 dark:text-slate-400"
                      colSpan={9}
                    >
                      Geen data gevonden.
                    </td>
                  </tr>
                )}
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className="hover:bg-gray-50 dark:hover:bg-slate-900/40"
                  >
                    <td className="px-4 py-3">{r.sector}</td>
                    <td className="px-4 py-3">
                      <a
                        href={`https://www.tradingview.com/symbols/${r.code}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {r.code}
                      </a>
                    </td>
                    <td className="px-4 py-3">{fmtPrice(r.close)}</td>
                    <td
                      className={`px-4 py-3 ${
                        Number(r.d1) > 0
                          ? 'text-emerald-600'
                          : Number(r.d1) < 0
                          ? 'text-red-600'
                          : ''
                      }`}
                    >
                      {fmtPct(r.d1)}
                    </td>
                    <td
                      className={`px-4 py-3 ${
                        Number(r.w1) > 0
                          ? 'text-emerald-600'
                          : Number(r.w1) < 0
                          ? 'text-red-600'
                          : ''
                      }`}
                    >
                      {fmtPct(r.w1)}
                    </td>
                    <td
                      className={`px-4 py-3 ${
                        Number(r.m1) > 0
                          ? 'text-emerald-600'
                          : Number(r.m1) < 0
                          ? 'text-red-600'
                          : ''
                      }`}
                    >
                      {fmtPct(r.m1)}
                    </td>
                    <td
                      className={`px-4 py-3 ${
                        Number(r.m3) > 0
                          ? 'text-emerald-600'
                          : Number(r.m3) < 0
                          ? 'text-red-600'
                          : ''
                      }`}
                    >
                      {fmtPct(r.m3)}
                    </td>
                    <td
                      className={`px-4 py-3 ${
                        Number(r.ytd) > 0
                          ? 'text-emerald-600'
                          : Number(r.ytd) < 0
                          ? 'text-red-600'
                          : ''
                      }`}
                    >
                      {fmtPct(r.ytd)}
                    </td>
                    <td
                      className={`px-4 py-3 ${
                        Number(r.y1) > 0
                          ? 'text-emerald-600'
                          : Number(r.y1) < 0
                          ? 'text-red-600'
                          : ''
                      }`}
                    >
                      {fmtPct(r.y1)}
                    </td>
                  </tr>
                ))}
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