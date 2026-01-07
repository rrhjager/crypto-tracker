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

// raw -> signal (BUY keeps sign, SELL flips sign)
function signalFromRaw(side: 'BUY' | 'SELL', raw: number | null) {
  if (raw == null) return null
  return side === 'BUY' ? raw : -raw
}

// signal -> raw (inverse mapping; used for MFE/MAE when API gives aligned numbers)
function rawFromSignal(side: 'BUY' | 'SELL', signal: number | null) {
  if (signal == null) return null
  return side === 'BUY' ? signal : -signal
}

function isValidBaseRow(r: Row) {
  if (r.error) return false
  if (!r.lastSignal) return false
  if (!r.current) return false
  if (!Number.isFinite(r.lastSignal.close) || !Number.isFinite(r.current.close)) return false
  return true
}

function openRawReturnToLatest(r: Row): number | null {
  if (!isValidBaseRow(r)) return null
  return pct(r.lastSignal!.close, r.current!.close)
}

/**
 * Directional summary:
 * - Converts raw price change into direction-aligned "signal return"
 * - Win = aligned > 0
 * - Avg/Median are also computed on aligned (so SELL down-moves improve stats)
 */
function buildDirectionalSummary(
  rows: Row[],
  getRaw: (r: Row) => number | null,
  isEligible: (r: Row) => boolean
): Summary {
  const eligible = rows.filter(isEligible)
  const alignedVals: number[] = []

  for (const r of eligible) {
    const side = r.lastSignal?.status
    if (!side) continue
    const raw = getRaw(r)
    if (raw == null || !Number.isFinite(raw)) continue
    const aligned = signalFromRaw(side, raw)
    if (aligned == null || !Number.isFinite(aligned)) continue
    alignedVals.push(aligned)
  }

  const nEligible = eligible.length
  const nIncluded = alignedVals.length

  if (nIncluded === 0) {
    return { nIncluded, nEligible, winRate: null, avg: null, med: null }
  }

  const wins = alignedVals.filter(v => v > 0).length
  return {
    nIncluded,
    nEligible,
    winRate: (wins / nIncluded) * 100,
    avg: mean(alignedVals),
    med: median(alignedVals),
  }
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
          <div className="text-white/55 text-xs">Avg (aligned)</div>
          <div className={`font-semibold ${pctClass(stat.avg)}`}>{fmtPct(stat.avg)}</div>
        </div>
        <div>
          <div className="text-white/55 text-xs">Median (aligned)</div>
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
      <div className="text-white/90 font-semibold">How to read this table</div>

      <div className="mt-2 grid md:grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-white/80 font-semibold">Price change (main number)</div>
          <div className="text-white/60 text-xs mt-1">
            The big percentage is the <b>real price move</b> from the signal close.
            For SELL, “winning” typically means the price is <b>down</b> (negative).
          </div>
        </div>

        <div>
          <div className="text-white/80 font-semibold">Signal (small line)</div>
          <div className="text-white/60 text-xs mt-1">
            The small <b>Signal:</b> line is direction-aligned: BUY uses the raw move, SELL flips the sign.
            This is what we use for <b>win rate</b>.
          </div>
        </div>

        <div>
          <div className="text-white/80 font-semibold">Until next signal</div>
          <div className="text-white/60 text-xs mt-1">
            Return from the signal close until the model changes status (to HOLD or the opposite).
            If no next signal happened yet, we show <b>Open → latest</b>.
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-white/45">
        Past performance is not a guarantee of future results.
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
  const eligibleBase = (r: Row) => isValidBaseRow(r)

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

  // RAW values for display columns
  const untilRaw = (r: Row) => {
    if (!eligibleBase(r)) return null
    if (r.nextSignal?.rawReturnPct != null && Number.isFinite(r.nextSignal.rawReturnPct)) return r.nextSignal.rawReturnPct
    return openRawReturnToLatest(r)
  }

  // Directional summaries (winrate correct for SELL)
  const sUntil = buildDirectionalSummary(rows, untilRaw, eligibleBase)
  const s7 = buildDirectionalSummary(rows, r => (show7d(r) ? (r.perf?.d7Raw ?? null) : null), eligibleBase)
  const s30 = buildDirectionalSummary(rows, r => (show30d(r) ? (r.perf?.d30Raw ?? null) : null), eligibleBase)

  // Convert MFE/MAE to raw for display/summary
  const mfeRaw = (r: Row) => (r.lastSignal ? rawFromSignal(r.lastSignal.status, r.untilNext?.mfeSignal ?? null) : null)
  const maeRaw = (r: Row) => (r.lastSignal ? rawFromSignal(r.lastSignal.status, r.untilNext?.maeSignal ?? null) : null)

  const sMfe = buildDirectionalSummary(rows, mfeRaw, eligibleBase)
  const sMae = buildDirectionalSummary(rows, maeRaw, eligibleBase)

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Crypto Past Performance</h1>
          <p className="text-white/70 text-sm">
            We show the most recent BUY/SELL switch per coin. The table focuses on <b>real price change</b>,
            while win rate is computed <b>directionally</b> (SELL wins when price drops).
          </p>
        </div>
        <Link href="/past-performance" className="text-sm text-white/70 hover:text-white">
          ← Back
        </Link>
      </div>

      <InfoCard />

      {/* Summary (directional winrate + aligned avg/median) */}
      <div className="mb-6 grid md:grid-cols-5 gap-4">
        <StatCard
          title="Until Next (or Latest)"
          subtitle="Directional (SELL down = win). Uses next signal, else open → latest."
          stat={sUntil}
        />
        <StatCard
          title="Price 7d"
          subtitle="Directional winrate after 7 days (only if ≥7 days of data)."
          stat={s7}
        />
        <StatCard
          title="Price 30d"
          subtitle="Directional winrate after 30 days (only if ≥30 days of data)."
          stat={s30}
        />
        <StatCard
          title="MFE (until next)"
          subtitle="Directional best move during holding period."
          stat={sMfe}
        />
        <StatCard
          title="MAE (until next)"
          subtitle="Directional worst move during holding period."
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
          <table className="min-w-[1550px] w-full text-sm">
            <thead className="bg-black/25 text-white/70">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Coin</th>
                <th className="text-left px-4 py-3 font-semibold">Last signal</th>
                <th className="text-left px-4 py-3 font-semibold">Signal score</th>

                <th className="text-left px-4 py-3 font-semibold">Until next (Price)</th>

                <th className="text-left px-4 py-3 font-semibold">Price 7d</th>
                <th className="text-left px-4 py-3 font-semibold">Price 30d</th>

                <th className="text-left px-4 py-3 font-semibold">MFE (Price)</th>
                <th className="text-left px-4 py-3 font-semibold">MAE (Price)</th>
                <th className="text-left px-4 py-3 font-semibold">Current</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/10">
              {rows.map((r) => {
                const side = r.lastSignal?.status

                const openRaw = openRawReturnToLatest(r)
                const openDays = r.lastSignal && r.current ? diffDays(r.lastSignal.date, r.current.date) : null

                const show7 = show7d(r)
                const show30 = show30d(r)

                const untilRawVal = untilRaw(r)
                const untilSignalVal = side ? signalFromRaw(side, untilRawVal) : null

                const d7Raw = show7 ? r.perf.d7Raw : null
                const d7Signal = side ? signalFromRaw(side, d7Raw) : null

                const d30Raw = show30 ? r.perf.d30Raw : null
                const d30Signal = side ? signalFromRaw(side, d30Raw) : null

                const mfeRawVal = mfeRaw(r)
                const mfeSignalVal = r.untilNext?.mfeSignal ?? null

                const maeRawVal = maeRaw(r)
                const maeSignalVal = r.untilNext?.maeSignal ?? null

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

                    <td className="px-4 py-3 text-white/80">{r.lastSignal ? r.lastSignal.score : '—'}</td>

                    {/* Until next (Price) */}
                    <td className="px-4 py-3">
                      {r.nextSignal ? (
                        <div className="text-xs">
                          <div className={`font-semibold ${pctClass(r.nextSignal.rawReturnPct)}`}>
                            {fmtPct(r.nextSignal.rawReturnPct)}
                          </div>
                          <div className="text-xs text-white/55">Signal: {fmtPct(r.nextSignal.signalReturnPct)}</div>
                          <div className="text-white/70">
                            {r.nextSignal.daysFromSignal}d → {r.nextSignal.status} (score {r.nextSignal.score})
                          </div>
                          <div className="text-white/55">{r.nextSignal.date}</div>
                        </div>
                      ) : eligibleBase(r) ? (
                        <div className="text-xs">
                          <div className={`font-semibold ${pctClass(openRaw)}`}>{fmtPct(openRaw)}</div>
                          <div className="text-xs text-white/55">Signal: {fmtPct(side ? signalFromRaw(side, openRaw) : null)}</div>
                          <div className="text-white/70">{openDays != null ? `${openDays}d` : '—'} → Open (no exit yet)</div>
                          <div className="text-white/55">{r.current?.date}</div>
                        </div>
                      ) : (
                        <span className="text-white/50 text-xs">—</span>
                      )}
                    </td>

                    {/* Price 7d */}
                    <td className={`px-4 py-3 ${pctClass(d7Raw)}`}>
                      <div className="font-semibold">{fmtPct(d7Raw)}</div>
                      <div className="text-xs text-white/55">Signal: {fmtPct(d7Signal)}</div>
                    </td>

                    {/* Price 30d */}
                    <td className={`px-4 py-3 ${pctClass(d30Raw)}`}>
                      <div className="font-semibold">{fmtPct(d30Raw)}</div>
                      <div className="text-xs text-white/55">Signal: {fmtPct(d30Signal)}</div>
                    </td>

                    {/* MFE/MAE (Price) */}
                    <td className={`px-4 py-3 ${pctClass(mfeRawVal)}`}>
                      <div className="font-semibold">{fmtPct(mfeRawVal)}</div>
                      <div className="text-xs text-white/55">Signal: {fmtPct(mfeSignalVal)}</div>
                    </td>

                    <td className={`px-4 py-3 ${pctClass(maeRawVal)}`}>
                      <div className="font-semibold">{fmtPct(maeRawVal)}</div>
                      <div className="text-xs text-white/55">Signal: {fmtPct(maeSignalVal)}</div>
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
        Main numbers show <b>Price</b> (raw). Win rate is computed directionally using <b>Signal</b> (BUY up = win, SELL down = win).
      </div>
    </main>
  )
}