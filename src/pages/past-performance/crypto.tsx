// src/pages/past-performance/crypto.tsx
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(r => r.json())

type Status = 'BUY' | 'HOLD' | 'SELL'

type Row = {
  coin: string
  name: string
  pair: string
  source?: string
  current: { date: string; status: Status; score: number; close: number } | null
  lastSignal: { date: string; status: 'BUY' | 'SELL'; score: number; close: number } | null
  perf: { h24: number | null; d7: number | null; d30: number | null }
  error?: string
}

function fmtPct(v: number | null) {
  if (v == null || !Number.isFinite(v)) return '—'
  const s = v >= 0 ? '+' : ''
  return `${s}${v.toFixed(2)}%`
}

function pctClass(v: number | null) {
  if (v == null || !Number.isFinite(v)) return 'text-white/50'
  if (v > 0) return 'text-green-200'
  if (v < 0) return 'text-red-200'
  return 'text-white/80'
}

export default function CryptoPastPerformancePage() {
  const { data, error, isLoading } = useSWR<{ meta: any; rows: Row[] }>(
    '/api/past-performance/crypto',
    fetcher,
    { revalidateOnFocus: false }
  )

  const rows = data?.rows || []

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Crypto Past Performance</h1>
          <p className="text-white/70 text-sm">
            Per crypto tonen we de <b>laatste BUY/SELL switch</b> en de return <b>24h / 7d / 30d</b> daarna (daily close-to-close).
          </p>
        </div>
        <Link href="/past-performance" className="text-sm text-white/70 hover:text-white">
          ← Back
        </Link>
      </div>

      {data?.meta?.note ? (
        <div className="mb-6 rounded-xl bg-white/[0.04] ring-1 ring-white/10 p-4 text-xs text-white/70">
          <div className="font-semibold text-white/85 mb-1">Method</div>
          <div>{data.meta.note}</div>
        </div>
      ) : null}

      {error ? (
        <div className="mb-6 rounded-xl bg-red-500/10 ring-1 ring-red-400/30 p-4 text-red-200">
          Failed to load: {String((error as any)?.message || error)}
        </div>
      ) : null}

      {isLoading ? <div className="text-white/70">Loading…</div> : null}

      <section className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-black/25 text-white/70">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Coin</th>
                <th className="text-left px-4 py-3 font-semibold">Last signal</th>
                <th className="text-left px-4 py-3 font-semibold">Signal score</th>
                <th className="text-left px-4 py-3 font-semibold">24h</th>
                <th className="text-left px-4 py-3 font-semibold">7d</th>
                <th className="text-left px-4 py-3 font-semibold">30d</th>
                <th className="text-left px-4 py-3 font-semibold">Current</th>
                <th className="text-left px-4 py-3 font-semibold">Source</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/10">
              {rows.map((r) => (
                <tr key={r.pair} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <div className="text-white/90 font-semibold">{r.coin}</div>
                    <div className="text-xs text-white/55">{r.name}</div>
                  </td>

                  <td className="px-4 py-3">
                    {r.error ? (
                      <span className="text-red-200 text-xs">{r.error}</span>
                    ) : r.lastSignal ? (
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            r.lastSignal.status === 'BUY'
                              ? 'bg-green-500/15 text-green-200 ring-1 ring-green-400/30'
                              : 'bg-red-500/15 text-red-200 ring-1 ring-red-400/30'
                          }`}
                        >
                          → {r.lastSignal.status}
                        </span>
                        <span className="text-white/80">{r.lastSignal.date}</span>
                      </div>
                    ) : (
                      <span className="text-white/50 text-xs">No BUY/SELL switch found</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-white/80">
                    {r.lastSignal ? r.lastSignal.score : '—'}
                  </td>

                  <td className={`px-4 py-3 font-semibold ${pctClass(r.perf.h24)}`}>{fmtPct(r.perf.h24)}</td>
                  <td className={`px-4 py-3 font-semibold ${pctClass(r.perf.d7)}`}>{fmtPct(r.perf.d7)}</td>
                  <td className={`px-4 py-3 font-semibold ${pctClass(r.perf.d30)}`}>{fmtPct(r.perf.d30)}</td>

                  <td className="px-4 py-3">
                    {r.current ? (
                      <div className="text-xs text-white/70">
                        <div className="text-white/85 font-semibold">
                          {r.current.status} (score {r.current.score})
                        </div>
                        <div>{r.current.date}</div>
                      </div>
                    ) : (
                      <span className="text-white/50 text-xs">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-xs text-white/55">
                    {r.source || '—'}
                  </td>
                </tr>
              ))}

              {!rows.length && !isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-white/60" colSpan={8}>
                    No data.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-4 text-xs text-white/50">
        Cells are “—” when the signal is too recent (not enough forward days yet). This still uses real historical candles.
      </div>
    </main>
  )
}