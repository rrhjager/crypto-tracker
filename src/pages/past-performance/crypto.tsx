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

  error?: string
}

function fmtPct(v: number | null) {
  if (v == null || !Number.isFinite(v)) return '—'
  const s = v >= 0 ? '+' : ''
  return `${s}${v.toFixed(2)}%`
}

function fmtEur(v: number | null) {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}€${v.toFixed(2)}`
}

// ✅ table colors: green if price up, red if price down
function priceMoveClass(raw: number | null) {
  if (raw == null || !Number.isFinite(raw)) return 'text-white/50'
  if (raw > 0) return 'text-green-200'
  if (raw < 0) return 'text-red-200'
  return 'text-white/80'
}

// ✅ summary % colors
function pctClassBySign(v: number | null) {
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

// raw -> signal (BUY keeps sign, SELL flips sign) — used internally for win rate/P&L
function signalFromRaw(side: 'BUY' | 'SELL', raw: number | null) {
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

/**
 * Directional summary:
 * - SELL down counts as win (aligned > 0)
 * - Used for win rate / avg / median in the cards
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

  if (nIncluded === 0) return { nIncluded, nEligible, winRate: null, avg: null, med: null }

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
          <div className="text-white/55 text-xs">Avg</div>
          <div className={`font-semibold ${pctClassBySign(stat.avg)}`}>{fmtPct(stat.avg)}</div>
        </div>
        <div>
          <div className="text-white/55 text-xs">Median</div>
          <div className={`font-semibold ${pctClassBySign(stat.med)}`}>{fmtPct(stat.med)}</div>
        </div>
      </div>

      <div className="mt-2 text-xs text-white/45">
        Included: {stat.nIncluded} / Eligible: {stat.nEligible}
      </div>
    </div>
  )
}

function ClosedPnlCard({
  title,
  subtitle,
  pnl1x,
  roi1x,
  pnl3x,
  roi3x,
  pnl10x,
  roi10x,
  n,
  totalInvested,
}: {
  title: string
  subtitle: string
  pnl1x: number
  roi1x: number | null
  pnl3x: number
  roi3x: number | null
  pnl10x: number
  roi10x: number | null
  n: number
  totalInvested: number
}) {
  return (
    <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-4">
      <div className="text-white/85 font-semibold">{title}</div>
      <div className="text-white/55 text-xs mt-1">{subtitle}</div>

      {/* 1x */}
      <div className="mt-3 rounded-xl bg-black/20 ring-1 ring-white/10 p-3">
        <div className="flex items-center justify-between">
          <div className="text-white/70 text-xs font-semibold">1x (spot)</div>
          <div className="text-xs text-white/45">Closed · {n} trades</div>
        </div>

        <div className={`text-lg font-extrabold mt-1 ${pnl1x >= 0 ? 'text-green-200' : 'text-red-200'}`}>
          {fmtEur(pnl1x)}
        </div>

        <div className="mt-1 text-xs text-white/70">
          Invested: €{totalInvested.toFixed(0)} · ROI:{' '}
          <span className={pctClassBySign(roi1x)}>{fmtPct(roi1x)}</span>
        </div>
      </div>

      {/* 3x + 10x (smaller, underneath) */}
      <div className="mt-3 rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-3">
        <div className="flex items-center justify-between">
          <div className="text-white/70 text-xs font-semibold">Leveraged (simulated)</div>
          <div className="text-xs text-white/45">Floor at -100%</div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-black/15 ring-1 ring-white/10 p-2">
            <div className="text-xs text-white/60 font-semibold">3x</div>
            <div className={`text-sm font-extrabold mt-1 ${pnl3x >= 0 ? 'text-green-200' : 'text-red-200'}`}>
              {fmtEur(pnl3x)}
            </div>
            <div className="text-xs text-white/70 mt-1">
              ROI: <span className={pctClassBySign(roi3x)}>{fmtPct(roi3x)}</span>
            </div>
          </div>

          <div className="rounded-lg bg-black/15 ring-1 ring-white/10 p-2">
            <div className="text-xs text-white/60 font-semibold">10x</div>
            <div className={`text-sm font-extrabold mt-1 ${pnl10x >= 0 ? 'text-green-200' : 'text-red-200'}`}>
              {fmtEur(pnl10x)}
            </div>
            <div className="text-xs text-white/70 mt-1">
              ROI: <span className={pctClassBySign(roi10x)}>{fmtPct(roi10x)}</span>
            </div>
          </div>
        </div>

        <div className="mt-2 text-[11px] text-white/45">
          Note: This is a simplified simulation (leverage × return, max loss capped at -100% per trade). Real liquidation
          depends on exchange rules, funding, fees, and intraday moves.
        </div>
      </div>

      <div className="mt-3 text-xs text-white/45">
        Assumption: €10 notional per signal. Exit at the moment the status changes.
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
          <div className="text-white/80 font-semibold">Price change</div>
          <div className="text-white/60 text-xs mt-1">
            The values shown are the <b>raw price moves</b> from the signal close.
          </div>
        </div>

        <div>
          <div className="text-white/80 font-semibold">Colors</div>
          <div className="text-white/60 text-xs mt-1">
            Simple: <b>green</b> = price went up, <b>red</b> = price went down.
          </div>
        </div>

        <div>
          <div className="text-white/80 font-semibold">Until next signal</div>
          <div className="text-white/60 text-xs mt-1">
            Performance until the model changes status. If no next signal exists yet, it shows “—”.
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-white/45">Past performance is not a guarantee of future results.</div>
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

  // Until next signal (closed only)
  const untilRawClosed = (r: Row) => {
    if (!eligibleBase(r)) return null
    if (r.nextSignal?.rawReturnPct != null && Number.isFinite(r.nextSignal.rawReturnPct)) return r.nextSignal.rawReturnPct
    return null
  }

  // Summary cards (directional internally)
  const sUntil = buildDirectionalSummary(rows, untilRawClosed, r => eligibleBase(r) && !!r.nextSignal)
  const s7 = buildDirectionalSummary(rows, r => (show7d(r) ? (r.perf?.d7Raw ?? null) : null), eligibleBase)
  const s30 = buildDirectionalSummary(rows, r => (show30d(r) ? (r.perf?.d30Raw ?? null) : null), eligibleBase)

  // Closed-only €10 P&L (directional)
  const betEur = 10
  const lev3 = 3
  const lev10 = 10

  let pnl1x = 0
  let pnl3x = 0
  let pnl10x = 0
  let nClosed = 0

  for (const r of rows) {
    if (!eligibleBase(r)) continue
    if (!r.nextSignal) continue

    const side = r.lastSignal!.status
    const raw = r.nextSignal.rawReturnPct
    if (raw == null || !Number.isFinite(raw)) continue

    const aligned = signalFromRaw(side, raw)
    if (aligned == null || !Number.isFinite(aligned)) continue

    // 1x
    pnl1x += (betEur * aligned) / 100

    // 3x simulated with -100% floor (max loss = full stake)
    const aligned3 = Math.max(-100, aligned * lev3)
    pnl3x += (betEur * aligned3) / 100

    // 10x simulated with -100% floor
    const aligned10 = Math.max(-100, aligned * lev10)
    pnl10x += (betEur * aligned10) / 100

    nClosed += 1
  }

  const totalInvested = nClosed * betEur
  const roi1x = totalInvested > 0 ? (pnl1x / totalInvested) * 100 : null
  const roi3x = totalInvested > 0 ? (pnl3x / totalInvested) * 100 : null
  const roi10x = totalInvested > 0 ? (pnl10x / totalInvested) * 100 : null

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Crypto Past Performance</h1>
          <p className="text-white/70 text-sm">
            We show the most recent BUY/SELL switch per coin. Table values are <b>raw price changes</b> (green up / red down).
          </p>
        </div>
        <Link href="/past-performance" className="text-sm text-white/70 hover:text-white">
          ← Back
        </Link>
      </div>

      <InfoCard />

      <div className="mb-6 grid md:grid-cols-4 gap-4">
        <StatCard
          title="Until next signal (closed)"
          subtitle="Directional win rate until the model changes status (closed trades only)."
          stat={sUntil}
        />
        <StatCard
          title="Price 7d"
          subtitle="Directional win rate after 7 days (only if ≥7 days of data)."
          stat={s7}
        />
        <StatCard
          title="Price 30d"
          subtitle="Directional win rate after 30 days (only if ≥30 days of data)."
          stat={s30}
        />
        <ClosedPnlCard
          title="€10 per signal"
          subtitle="Directional P&L: BUY benefits from up, SELL benefits from down. Closed only."
          pnl1x={pnl1x}
          roi1x={roi1x}
          pnl3x={pnl3x}
          roi3x={roi3x}
          pnl10x={pnl10x}
          roi10x={roi10x}
          n={nClosed}
          totalInvested={totalInvested}
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
          <table className="min-w-[1300px] w-full text-sm">
            <thead className="bg-black/25 text-white/70">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Coin</th>
                <th className="text-left px-4 py-3 font-semibold">Last signal</th>
                <th className="text-left px-4 py-3 font-semibold">Signal score</th>
                <th className="text-left px-4 py-3 font-semibold">Until next signal</th>
                <th className="text-left px-4 py-3 font-semibold">Price 7d</th>
                <th className="text-left px-4 py-3 font-semibold">Price 30d</th>
                <th className="text-left px-4 py-3 font-semibold">Current</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/10">
              {rows.map((r) => {
                const openDays = r.lastSignal && r.current ? diffDays(r.lastSignal.date, r.current.date) : null
                const show7 = show7d(r)
                const show30 = show30d(r)

                const d7Raw = show7 ? r.perf.d7Raw : null
                const d30Raw = show30 ? r.perf.d30Raw : null

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

                    <td className="px-4 py-3">
                      {r.nextSignal ? (
                        <div className="text-xs">
                          <div className={`font-semibold ${priceMoveClass(r.nextSignal.rawReturnPct)}`}>
                            {fmtPct(r.nextSignal.rawReturnPct)}
                          </div>
                          <div className="text-white/70">
                            {r.nextSignal.daysFromSignal}d → {r.nextSignal.status} (score {r.nextSignal.score})
                          </div>
                          <div className="text-white/55">{r.nextSignal.date}</div>
                        </div>
                      ) : eligibleBase(r) ? (
                        <div className="text-xs text-white/50">
                          — <span className="ml-1">(still open · {openDays != null ? `${openDays}d` : '—'})</span>
                        </div>
                      ) : (
                        <span className="text-white/50 text-xs">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className={`font-semibold ${priceMoveClass(d7Raw)}`}>{fmtPct(d7Raw)}</div>
                    </td>

                    <td className="px-4 py-3">
                      <div className={`font-semibold ${priceMoveClass(d30Raw)}`}>{fmtPct(d30Raw)}</div>
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
        Table colors show raw price direction (green up / red down). P&L is computed directionally (SELL down counts as win).
        3x/10x are simplified simulations (leverage × return, floored at -100%).
      </div>
    </main>
  )
}