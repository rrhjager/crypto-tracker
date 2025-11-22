// src/pages/intel/macro/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type Row = {
  dateISO: string
  dateLabel: string
  event: string
  impact: 'low'|'medium'|'high'
  region: string
  sourceUrl?: string
}

export default function MacroCalendar() {
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [hint, setHint] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)

  const apiUrl = useMemo(() => `/api/market/macro?days=120`, [])

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setErr(null); setHint(null); setDetail(null); setLoading(true)
        const r = await fetch(apiUrl, { cache: 'no-store' })
        let j: any = {}
        try { j = await r.json() } catch {}
        if (!r.ok) {
          if (!aborted) {
            setErr(`HTTP ${r.status}`)
            if (j?.hint) setHint(String(j.hint))
            if (j?.detail) setDetail(String(j.detail))
            setRows([])
          }
          return
        }
        if (!aborted) {
          setRows(Array.isArray(j.items) ? j.items : [])
          if (j?.hint) setHint(String(j.hint))
          if (j?.detail) setDetail(String(j.detail))
        }
      } catch (e: any) {
        if (!aborted) {
          setErr(String(e?.message || e))
          setRows([])
        }
      } finally {
        if (!aborted) setLoading(false)
      }
    })()
    return () => { aborted = true }
  }, [apiUrl])

  //
  // Dark-mode impact chips
  //
  const chip = (impact: Row['impact']) =>
    impact === 'high'
      ? 'bg-red-600/15 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-600/30 dark:border-red-600/40'
      : impact === 'medium'
      ? 'bg-amber-500/15 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-500/30 dark:border-amber-500/40'
      : 'bg-gray-500/15 dark:bg-slate-800 text-gray-700 dark:text-slate-300 border-gray-500/30 dark:border-slate-600'

  return (
    <>
      <Head><title>Macro Calendar — SignalHub</title></Head>

      <main className="min-h-screen text-gray-900 dark:text-slate-100">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-4">
          <h1 className="hero">Macro Calendar</h1>
          {err && (
            <div className="mt-2 text-sm text-red-600 dark:text-red-400">
              Fout bij laden: {err}{detail ? ` — ${detail}` : ''}
            </div>
          )}
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16">
          <div className="table-card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-950/70 border-b border-gray-200 dark:border-white/10">
                <tr className="text-left text-gray-500 dark:text-slate-200">
                  <th className="px-4 py-3 w-[140px]">Datum</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3 w-[160px]">Impact</th>
                  <th className="px-4 py-3 w-[160px]">Regio</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {loading && (
                  <tr>
                    <td className="px-4 py-3 text-gray-500 dark:text-slate-400" colSpan={4}>
                      Laden…
                    </td>
                  </tr>
                )}

                {!loading && rows.length === 0 && (
                  <tr>
                    <td className="px-4 py-3 text-gray-500 dark:text-slate-400" colSpan={4}>
                      Geen events gevonden.
                    </td>
                  </tr>
                )}

                {rows.map((r, i) => (
                  <tr
                    key={`${r.dateISO}-${r.event}-${i}`}
                    className="hover:bg-gray-50 dark:hover:bg-slate-900/40"
                  >
                    <td className="px-4 py-3">{r.dateLabel}</td>

                    <td className="px-4 py-3">
                      {r.sourceUrl ? (
                        <a
                          href={r.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline dark:text-blue-400"
                          title="Bekijk op FRED (met link naar officiële bron/press release)"
                        >
                          {r.event}
                        </a>
                      ) : (
                        r.event
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`inline-block text-xs font-semibold px-2 py-1 rounded-full border ${chip(
                          r.impact
                        )}`}
                      >
                        {r.impact.toUpperCase()}
                      </span>
                    </td>

                    <td className="px-4 py-3">{r.region}</td>
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