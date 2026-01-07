import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(r => r.json())

type Status = 'BUY' | 'HOLD' | 'SELL'

type NextSignal = {
  date: string
  status: Status
  score: number
  close: number
  daysFromSignal: number
  rawReturnPct: number | null
  signalReturnPct: number | null
}

type Row = {
  coin: string
  name: string
  pair: string
  source?: string
  current: { date: string; status: Status; score: number; close: number } | null
  lastSignal: { date: string; status: 'BUY' | 'SELL'; score: number; close: number } | null
  perf: { d7Raw: number | null; d7Signal: number | null; d30Raw: number | null; d30Signal: number | null }
  nextSignal: NextSignal | null
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

function median(nums: number[]) {
  if (!nums.length) return null
  const a = nums.slice().sort((x, y) => x - y)
  const mid = Math.floor(a.length / 2)
  if (a.length % 2 === 1) return a[mid]
  return (a[mid - 1] + a[mid]) / 2
}

function mean(nums: number[]) {
  if (!nums.length) return null
  return nums.reduce((s, x) => s + x, 0) / nums.length
}

function buildSummary(values: Array<number | null>) {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v))
  const n = nums.length
  if (n === 0) {
    return { n: 0, winRate: null as number | null, avg: null as number | null, med: null as number | null }
  }
  const wins = nums.filter(v => v > 0).length
  return {
    n,
    winRate: (wins / n) * 100,
    avg: mean(nums),
    med: median(nums),
  }
}

function StatCard({
  title,
  subtitle,
  stat,
}: {
  title: string
  subtitle: string
  stat: { n: number; winRate: number | null; avg: number | null; med: number | null }
}) {
  return (
    <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-4">
      <div className="text-white/85 font-semibold">{title}</div>
      <div className="text-white/55 text-xs mt-1">{subtitle}</div>

      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-white/55 text-xs">Win rate</div>
          <div className="text-white/90 font-semibold">
            {stat.winRate == null ? '—' : `${stat.winRate.toFixed(0)}%`}
          </div>
        </div>
        <div>
          <div className="text-white/55 text-xs">Avg</div>
          <div className={`font-semibold ${pctClass(stat.avg)}`}>{fmtPct(stat.avg)}</div>
        </div>
        <div>
          <div className="text-white/55 text-xs">Median</div>
          <div className={`font-semibold ${pctClass(stat.med)}`}>{fmtPct(stat.med)}</div>
        </div>
      </div>

      <div className="mt-2 text-xs text-white/45">Sample size: {stat.n}</div>
    </div>
  )
}

export default function CryptoPastPerformancePage() {
  const { data, error, isLoading } = useSWR<{ meta: any; rows: Row[] }>(
    '/api/past-performance/crypto',
    fetcher,
    { revalidateOnFocus: false }
  )

  const rows = data?.rows || []

  const s7 = buildSummary(rows.map(r => r.perf?.d7Signal ?? null))
  const s30 = buildSummary(rows.map(r => r.perf?.d30Signal ?? null))
  const sUntil = buildSummary(rows.map(r => r.nextSignal?.signalReturnPct ?? null))

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Crypto Past Performance</h1>
          <p className="text-white/70 text-sm">
            We show the most recent BUY/SELL switch per coin. Returns are measured from the <b>signal day close</b>.
            The table uses <b>signal return</b>: BUY = long return, SELL = short/avoid return (sign flipped).
          </p>
        </div>
        <Link href="/past-performance" className="text-sm text-white/70 hover:text-white">
          ← Back
        </Link>
      </div>

      {/* Summary */}
      <div className="mb-6 grid md:grid-cols-3 gap-4">
        <StatCard
          title="7D Signal Return"
          subtitle="Direction-aligned return from signal close to close 7 days later."
          stat={s7}
        />
        <StatCard
          title="30D Signal Return"
          subtitle="Direction-aligned return from signal close to close 30 days later."
          stat={s30}
        />
        <StatCard
          title="Until Next Signal"
          subtitle="Direction-aligned return from signal close until the model changes status."
          stat={sUntil}
        />
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
          <table className="min-w-[1000px] w-full text-sm">
            <thead className="bg-black/25 text-white/70">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Coin</th>
                <th className="text-left px-4 py-3 font-semibold">Last signal</th>
                <th className="text-left px-4 py-3 font-semibold">Signal score</th>
                <th className="text-left px-4 py-3 font-semibold">7d signal return</th>
                <th className="text-left px-4 py-3 font-semibold">30d signal return</th>
                <th className="text-left px-4 py-3 font-semibold">Until next signal</th>
                <th className="text-left px-4 py-3 font-semibold">Current</th>
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

                  <td className={`px-4 py-3 font-semibold ${pctClass(r.perf.d7Signal)}`}>
                    {fmtPct(r.perf.d7Signal)}
                  </td>

                  <td className={`px-4 py-3 font-semibold ${pctClass(r.perf.d30Signal)}`}>
                    {fmtPct(r.perf.d30Signal)}
                  </td>

                  <td className="px-4 py-3">
                    {r.nextSignal ? (
                      <div className="text-xs">
                        <div className={`font-semibold ${pctClass(r.nextSignal.signalReturnPct)}`}>
                          {fmtPct(r.nextSignal.signalReturnPct)}
                        </div>
                        <div className="text-white/70">
                          {r.nextSignal.daysFromSignal}d → {r.nextSignal.status} (score {r.nextSignal.score})
                        </div>
                        <div className="text-white/55">{r.nextSignal.date}</div>
                      </div>
                    ) : (
                      <span className="text-white/50 text-xs">—</span>
                    )}
                  </td>

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
                </tr>
              ))}

              {!rows.length && !isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-white/60" colSpan={7}>
                    No data.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-4 text-xs text-white/50">
        Notes: “Signal return” is direction-aligned (BUY = long, SELL = short/avoid). “—” means the last signal is too recent (not enough forward daily candles), or no next signal has occurred yet.
      </div>
    </main>
  )
}