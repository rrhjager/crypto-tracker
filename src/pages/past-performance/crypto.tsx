import Link from 'next/link'
import type { GetServerSideProps } from 'next'

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

type PageProps = {
  rows: Row[]
  fetchError?: string | null
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

// table colors: green if price up, red if price down
function priceMoveClass(raw: number | null) {
  if (raw == null || !Number.isFinite(raw)) return 'text-white/50'
  if (raw > 0) return 'text-green-200'
  if (raw < 0) return 'text-red-200'
  return 'text-white/80'
}

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

// raw -> signal (BUY keeps sign, SELL flips sign)
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

/**
 * ✅ Updated to match the "block-in-block" style of ClosedPnlCard:
 * - Outer card
 * - Inner panel (bg-black/20 + ring)
 * - Small label top-right
 */
function StatCard({
  title,
  subtitle,
  stat,
}: {
  title: string
  subtitle: string
  stat: Summary
}) {
  const winTxt = stat.winRate == null ? '—' : `${stat.winRate.toFixed(0)}%`
  // ✅ requested: win% green above 50%, red below 50%
  const winCls =
    stat.winRate == null
      ? 'text-white/90'
      : stat.winRate > 50
      ? 'text-green-200'
      : stat.winRate < 50
      ? 'text-red-200'
      : 'text-white/90'

  return (
    <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-4">
      <div className="text-white/85 font-semibold">{title}</div>
      <div className="text-white/55 text-xs mt-1">{subtitle}</div>

      <div className="mt-3 rounded-xl bg-black/20 ring-1 ring-white/10 p-3">
        <div className="flex items-center justify-end">
          <div className="text-xs text-white/45">
            Included · {stat.nIncluded} / {stat.nEligible}
          </div>
        </div>

        <div className={`text-lg font-extrabold mt-1 ${winCls}`}>{winTxt}</div>

        <div className="mt-1 grid grid-cols-2 gap-3 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-white/55">Avg</div>
            <div className={`font-semibold ${pctClassBySign(stat.avg)}`}>{fmtPct(stat.avg)}</div>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-white/55">Median</div>
            <div className={`font-semibold ${pctClassBySign(stat.med)}`}>{fmtPct(stat.med)}</div>
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-white/45">Win rate is directional (SELL wins when price drops).</div>
    </div>
  )
}

function ClosedPnlCard({
  title,
  subtitle,
  pnl,
  roi,
  n,
  totalInvested,
}: {
  title: string
  subtitle: string
  pnl: number
  roi: number | null
  n: number
  totalInvested: number
}) {
  return (
    <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-4">
      <div className="text-white/85 font-semibold">{title}</div>
      <div className="text-white/55 text-xs mt-1">{subtitle}</div>

      <div className="mt-3 rounded-xl bg-black/20 ring-1 ring-white/10 p-3">
        <div className="flex items-center justify-end">
          <div className="text-xs text-white/45">Closed · {n} trades</div>
        </div>

        <div className={`text-lg font-extrabold mt-1 ${pnl >= 0 ? 'text-green-200' : 'text-red-200'}`}>
          {fmtEur(pnl)}
        </div>

        <div className="mt-1 text-xs text-white/70">
          Invested: €{totalInvested.toFixed(0)} · ROI:{' '}
          <span className={pctClassBySign(roi)}>{fmtPct(roi)}</span>
        </div>
      </div>

      <div className="mt-3 text-xs text-white/45">
        Assumption: €10 notional per signal. Exit at the moment the status changes.
      </div>
    </div>
  )
}

export default function CryptoPastPerformancePage({ rows, fetchError }: PageProps) {
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

  const untilRawClosed = (r: Row) => {
    if (!eligibleBase(r)) return null
    if (r.nextSignal?.rawReturnPct != null && Number.isFinite(r.nextSignal.rawReturnPct)) return r.nextSignal.rawReturnPct
    return null
  }

  const sUntil = buildDirectionalSummary(rows, untilRawClosed, r => eligibleBase(r) && !!r.nextSignal)
  const s7 = buildDirectionalSummary(rows, r => (show7d(r) ? (r.perf?.d7Raw ?? null) : null), eligibleBase)
  const s30 = buildDirectionalSummary(rows, r => (show30d(r) ? (r.perf?.d30Raw ?? null) : null), eligibleBase)

  const betEur = 10
  let pnl = 0
  let nClosed = 0

  for (const r of rows) {
    if (!eligibleBase(r)) continue
    if (!r.nextSignal) continue
    const side = r.lastSignal!.status
    const raw = r.nextSignal.rawReturnPct
    if (raw == null || !Number.isFinite(raw)) continue
    const aligned = signalFromRaw(side, raw)
    if (aligned == null || !Number.isFinite(aligned)) continue
    pnl += (betEur * aligned) / 100
    nClosed += 1
  }

  const totalInvested = nClosed * betEur
  const roi = totalInvested > 0 ? (pnl / totalInvested) * 100 : null

  // ✅ Route to coin page (same pattern as your crypto list page)
  // If your project uses a different route, change only this function.
  const coinHref = (r: Row) => `/crypto/${encodeURIComponent(String(r.coin || '').toLowerCase())}`

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Crypto Past Performance</h1>
        </div>
        <Link href="/past-performance" className="text-sm text-white/70 hover:text-white">
          ← Back
        </Link>
      </div>

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
          pnl={pnl}
          roi={roi}
          n={nClosed}
          totalInvested={totalInvested}
        />
      </div>

      {fetchError ? (
        <div className="mb-6 rounded-xl bg-red-500/10 ring-1 ring-red-400/30 p-4 text-red-200">
          Failed to load: {fetchError}
        </div>
      ) : null}

      {/* ✅ TABLE: no horizontal scroll + compact layout */}
      <section className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: '16%' }} /> {/* Coin */}
            <col style={{ width: '18%' }} /> {/* Last signal */}
            <col style={{ width: '8%' }} /> {/* Signal score */}
            <col style={{ width: '22%' }} /> {/* Until next signal */}
            <col style={{ width: '12%' }} /> {/* Price 7d */}
            <col style={{ width: '12%' }} /> {/* Price 30d */}
            <col style={{ width: '12%' }} /> {/* Current */}
          </colgroup>

          <thead className="bg-black/25 text-white/70">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-semibold">Coin</th>
              <th className="text-left px-3 py-2 text-xs font-semibold">Last signal</th>
              <th className="text-left px-3 py-2 text-xs font-semibold">Score</th>
              <th className="text-left px-3 py-2 text-xs font-semibold">Until next</th>
              <th className="text-left px-3 py-2 text-xs font-semibold">7d</th>
              <th className="text-left px-3 py-2 text-xs font-semibold">30d</th>
              <th className="text-left px-3 py-2 text-xs font-semibold">Current</th>
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
                <tr key={r.pair} className="hover:bg-white/[0.03] align-top">
                  {/* ✅ Coin (clickable) */}
                  <td className="px-3 py-2">
                    <Link href={coinHref(r)} className="group block">
                      <div className="text-white/90 font-semibold truncate group-hover:text-white">
                        {r.coin}
                      </div>
                      <div className="text-xs text-white/55 truncate group-hover:text-white/70">
                        {r.name}
                      </div>
                    </Link>
                  </td>

                  {/* Last signal */}
                  <td className="px-3 py-2">
                    {r.error ? (
                      <span className="text-red-200 text-xs">{r.error}</span>
                    ) : r.lastSignal ? (
                      <div className="flex flex-col gap-1">
                        <span
                          className={`w-fit text-xs px-2 py-1 rounded ${
                            r.lastSignal.status === 'BUY'
                              ? 'bg-green-500/15 text-green-200 ring-1 ring-green-400/30'
                              : 'bg-red-500/15 text-red-200 ring-1 ring-red-400/30'
                          }`}
                        >
                          → {r.lastSignal.status}
                        </span>
                        <span className="text-xs text-white/80">{r.lastSignal.date}</span>
                      </div>
                    ) : (
                      <span className="text-white/50 text-xs">No BUY/SELL switch found</span>
                    )}
                  </td>

                  {/* Score */}
                  <td className="px-3 py-2">
                    <div className="text-white/90 font-semibold tabular-nums">
                      {r.lastSignal ? r.lastSignal.score : '—'}
                    </div>
                  </td>

                  {/* Until next */}
                  <td className="px-3 py-2">
                    {r.nextSignal ? (
                      <div className="flex flex-col gap-1">
                        <div className={`font-semibold tabular-nums ${priceMoveClass(r.nextSignal.rawReturnPct)}`}>
                          {fmtPct(r.nextSignal.rawReturnPct)}
                        </div>
                        <div className="text-xs text-white/70 truncate">
                          {r.nextSignal.daysFromSignal}d → {r.nextSignal.status} (score {r.nextSignal.score})
                        </div>
                        <div className="text-xs text-white/55">{r.nextSignal.date}</div>
                      </div>
                    ) : eligibleBase(r) ? (
                      <div className="text-xs text-white/50">
                        — <span className="ml-1">(still open · {openDays != null ? `${openDays}d` : '—'})</span>
                      </div>
                    ) : (
                      <span className="text-white/50 text-xs">—</span>
                    )}
                  </td>

                  {/* 7d */}
                  <td className="px-3 py-2">
                    <div className={`font-semibold tabular-nums ${priceMoveClass(d7Raw)}`}>{fmtPct(d7Raw)}</div>
                  </td>

                  {/* 30d */}
                  <td className="px-3 py-2">
                    <div className={`font-semibold tabular-nums ${priceMoveClass(d30Raw)}`}>{fmtPct(d30Raw)}</div>
                  </td>

                  {/* Current */}
                  <td className="px-3 py-2">
                    {r.current ? (
                      <div className="flex flex-col gap-1">
                        <div className="text-xs text-white/85 font-semibold truncate">
                          {r.current.status} (score {r.current.score})
                        </div>
                        <div className="text-xs text-white/70">{r.current.date}</div>
                      </div>
                    ) : (
                      <span className="text-white/50 text-xs">—</span>
                    )}
                  </td>
                </tr>
              )
            })}

            {!rows.length ? (
              <tr>
                <td className="px-3 py-6 text-white/60" colSpan={7}>
                  No data.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  try {
    const host = ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host
    const proto = (ctx.req.headers['x-forwarded-proto'] as string) || 'http'
    const baseUrl = `${proto}://${host}`

    const r = await fetch(`${baseUrl}/api/past-performance/crypto`, {
      headers: { accept: 'application/json' },
    })

    if (!r.ok) {
      return { props: { rows: [], fetchError: `API error: ${r.status}` } }
    }

    const json = await r.json()
    const rows = Array.isArray(json?.rows) ? (json.rows as Row[]) : []

    return { props: { rows, fetchError: null } }
  } catch (e: any) {
    return { props: { rows: [], fetchError: e?.message || 'Failed to fetch' } }
  }
}