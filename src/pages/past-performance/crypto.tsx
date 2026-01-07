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

  current: { date: string; status: Status; score: number; close: number } | null
  lastSignal: { date: string; status: 'BUY' | 'SELL'; score: number; close: number } | null

  perf: {
    d7Raw: number | null
    d7Signal: number | null
    d30Raw: number | null
    d30Signal: number | null
  }

  nextSignal: NextSignal | null

  untilNext: {
    days: number | null
    mfeSignal: number | null
    maeSignal: number | null
  }

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

type Summary = {
  nIncluded: number
  nEligible: number
  winRate: number | null
  avg: number | null
  med: number | null
}

function buildSummaryFromRows(
  rows: Row[],
  getValue: (r: Row) => number | null,
  isEligible: (r: Row) => boolean
): Summary {
  const eligible = rows.filter(isEligible)
  const vals = eligible.map(getValue).filter((v): v is number => v != null && Number.isFinite(v))
  const nEligible = eligible.length
  const nIncluded = vals.length
  if (nIncluded === 0) {
    return { nIncluded, nEligible, winRate: null, avg: null, med: null }
  }
  const wins = vals.filter(v => v > 0).length
  return {
    nIncluded,
    nEligible,
    winRate: (wins / nIncluded) * 100,
    avg: mean(vals),
    med: median(vals),
  }
}

function safeDate(d: string | null | undefined) {
  if (!d) return null
  const dt = new Date(d + 'T00:00:00Z')
  if (!Number.isFinite(dt.getTime())) return null
  return dt
}

function diffDays(fromISO: string, toISO: string) {
  const a = safeDate(fromISO)
  const b = safeDate(toISO)
  if (!a || !b) return null
  const ms = b.getTime() - a.getTime()
  return Math.max(0, Math.round(ms / 86400000))
}

function pct(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  return ((to / from) - 1) * 100
}

// BUY: raw return; SELL: flip sign (so down-move becomes positive)
function signalAlign(side: 'BUY' | 'SELL', raw: number | null) {
  if (raw == null) return null
  return side === 'BUY' ? raw : -raw
}

function isValidBaseRow(r: Row) {
  if (r.error) return false
  if (!r.lastSignal) return false
  if (!r.current) return false
  if (!Number.isFinite(r.lastSignal.close) || !Number.isFinite(r.current.close)) return false
  return true
}

function openSignalReturnToLatest(r: Row): number | null {
  if (!isValidBaseRow(r)) return null
  const side = r.lastSignal!.status
  const raw = pct(r.lastSignal!.close, r.current!.close)
  return signalAlign(side, raw)
}

function StatCard({
  title,
  subtitle,
  stat,
}: {
  title: string
  subtitle: string
  stat: Summary
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

      <div className="mt-2 text-xs text-white/45">
        Included: {stat.nIncluded} / Eligible: {stat.nEligible}
      </div>
    </div>
  )
}

function InfoCard() {
  return (
    <div className="mb-6 rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-4">
      <div className="text-white/90 font-semibold">What you’re looking at</div>

      <div className="mt-2 grid md:grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-white/80 font-semibold">Signal return</div>
          <div className="text-white/60 text-xs mt-1">
            Direction-aligned performance: <b>BUY</b> treats upward moves as positive, <b>SELL</b> treats downward moves as positive (sign flipped).
            This keeps the proof intuitive.
          </div>
        </div>

        <div>
          <div className="text-white/80 font-semibold">Until next signal</div>
          <div className="text-white/60 text-xs mt-1">
            The “strategy view”: return from the signal day close until the model changes status (to HOLD or the opposite).
            If no next signal happened yet, we show <b>Open → latest</b> as a live snapshot.
          </div>
        </div>

        <div>
          <div className="text-white/80 font-semibold">MFE / MAE</div>
          <div className="text-white/60 text-xs mt-1">
            <b>MFE</b> = best move in your direction during the holding period. <b>MAE</b> = worst move against you.
            Strong signals tend to show <b>high MFE</b> and <b>contained MAE</b> (edge + manageable risk).
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-white/45">
        Past performance is not a guarantee of future results. This page exists to make the signals measurable and transparent.
      </div>
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

  // Eligibility: only count rows that have a valid signal + current price and no error
  const eligibleBase = (r: Row) => isValidBaseRow(r)

  // Until next (or latest): use nextSignal if exists, else "open to latest"
  const untilValue = (r: Row) => {
    if (!eligibleBase(r)) return null
    if (r.nextSignal?.signalReturnPct != null && Number.isFinite(r.nextSignal.signalReturnPct)) {
      return r.nextSignal.signalReturnPct
    }
    return openSignalReturnToLatest(r)
  }

  // Guard horizons in UI + summary (in case of stale cache)
  const show7d = (r: Row) => {
    if (!eligibleBase(r)) return false
    if (r.nextSignal && Number.isFinite(r.nextSignal.daysFromSignal)) return r.nextSignal.daysFromSignal >= 7
    const days = diffDays(r.lastSignal!.date, r.current!.date)
    return days != null && days >= 7
  }
  const show30d = (r: Row) => {
    if (!eligibleBase(r)) return false
    if (r.nextSignal && Number.isFinite(r.nextSignal.daysFromSignal)) return r.nextSignal.daysFromSignal >= 30
    const days = diffDays(r.lastSignal!.date, r.current!.date)
    return days != null && days >= 30
  }

  // Summaries (exclude nulls automatically; exclude bad rows via eligibleBase)
  const sUntil = buildSummaryFromRows(rows, untilValue, eligibleBase)
  const s7 = buildSummaryFromRows(
    rows,
    r => (show7d(r) ? (r.perf?.d7Signal ?? null) : null),
    eligibleBase
  )
  const s30 = buildSummaryFromRows(
    rows,
    r => (show30d(r) ? (r.perf?.d30Signal ?? null) : null),
    eligibleBase
  )
  const sMfe = buildSummaryFromRows(rows, r => r.untilNext?.mfeSignal ?? null, eligibleBase)
  const sMae = buildSummaryFromRows(rows, r => r.untilNext?.maeSignal ?? null, eligibleBase)

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Crypto Past Performance</h1>
          <p className="text-white/70 text-sm">
            A transparent track record for our BUY/SELL signals (daily timeframe). Start with <b>Until next signal</b> to see what happened before the model changed its mind.
          </p>
        </div>
        <Link href="/past-performance" className="text-sm text-white/70 hover:text-white">
          ← Back
        </Link>
      </div>

      <InfoCard />

      {/* Summary */}
      <div className="mb-6 grid md:grid-cols-5 gap-4">
        <StatCard
          title="Until Next (or Latest)"
          subtitle="Closed at next signal, or open performance to the latest close."
          stat={sUntil}
        />
        <StatCard
          title="7D Signal Return"
          subtitle="Only when the signal stayed active (or existed) for ≥7 days."
          stat={s7}
        />
        <StatCard
          title="30D Signal Return"
          subtitle="Only when the signal stayed active (or existed) for ≥30 days."
          stat={s30}
        />
        <StatCard
          title="MFE Until Next"
          subtitle="Best move in your direction during the holding period."
          stat={sMfe}
        />
        <StatCard
          title="MAE Until Next"
          subtitle="Worst move against you during the holding period."
          stat={sMae}
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
          <table className="min-w-[1350px] w-full text-sm">
            <thead className="bg-black/25 text-white/70">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Coin</th>
                <th className="text-left px-4 py-3 font-semibold">Last signal</th>
                <th className="text-left px-4 py-3 font-semibold">Signal score</th>

                <th className="text-left px-4 py-3 font-semibold">Until next signal</th>

                <th className="text-left px-4 py-3 font-semibold">7d</th>
                <th className="text-left px-4 py-3 font-semibold">30d</th>
                <th className="text-left px-4 py-3 font-semibold">MFE</th>
                <th className="text-left px-4 py-3 font-semibold">MAE</th>
                <th className="text-left px-4 py-3 font-semibold">Current</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/10">
              {rows.map((r) => {
                const openRet = openSignalReturnToLatest(r)
                const openDays =
                  r.lastSignal && r.current ? diffDays(r.lastSignal.date, r.current.date) : null

                const show7 = show7d(r)
                const show30 = show30d(r)

                return (
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

                    {/* Until next signal */}
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
                      ) : eligibleBase(r) ? (
                        <div className="text-xs">
                          <div className={`font-semibold ${pctClass(openRet)}`}>{fmtPct(openRet)}</div>
                          <div className="text-white/70">
                            {openDays != null ? `${openDays}d` : '—'} → Open (no exit yet)
                          </div>
                          <div className="text-white/55">{r.current?.date}</div>
                        </div>
                      ) : (
                        <span className="text-white/50 text-xs">—</span>
                      )}
                    </td>

                    <td className={`px-4 py-3 font-semibold ${pctClass(show7 ? r.perf.d7Signal : null)}`}>
                      {fmtPct(show7 ? r.perf.d7Signal : null)}
                    </td>

                    <td className={`px-4 py-3 font-semibold ${pctClass(show30 ? r.perf.d30Signal : null)}`}>
                      {fmtPct(show30 ? r.perf.d30Signal : null)}
                    </td>

                    <td className={`px-4 py-3 font-semibold ${pctClass(r.untilNext?.mfeSignal ?? null)}`}>
                      {fmtPct(r.untilNext?.mfeSignal ?? null)}
                    </td>

                    <td className={`px-4 py-3 font-semibold ${pctClass(r.untilNext?.maeSignal ?? null)}`}>
                      {fmtPct(r.untilNext?.maeSignal ?? null)}
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
                )
              })}

              {!rows.length && !isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-white/60" colSpan={9}>
                    No data.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-4 text-xs text-white/50">
        “—” means insufficient history / too recent / or missing data. Summary cards exclude rows with errors and rows without a valid last signal + current price.
      </div>
    </main>
  )
}
