// src/pages/past-performance/crypto-900.tsx
import Link from 'next/link'
import type { GetServerSideProps } from 'next'

type EnterAfter7dUntilNextStats = {
  included: number
  winrate: number | null // 0..1
  avg: number | null     // pct points (e.g. +2.10)
  median: number | null  // pct points
}

type PerCoin = {
  coin: string
  pair: string
  nEvents: number
  nClosed: number
  nEligible7d: number
  winrate7d: number | null // 0..1
}

type PageProps = {
  stats: EnterAfter7dUntilNextStats | null
  sampleSize: { totalEvents: number; eligible7d: number } | null
  perCoin: PerCoin[]
  fetchError?: string | null
}

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return '—'
  const s = v >= 0 ? '+' : ''
  return `${s}${Number(v).toFixed(2)}%`
}
function fmtWinRate01(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${Math.round(v * 100)}%`
}
function pctClassBySign(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return 'text-white/50'
  if (v > 0) return 'text-green-200'
  if (v < 0) return 'text-red-200'
  return 'text-white/80'
}

function StatCardHistory({
  title,
  subtitle,
  stats,
  sampleSize,
}: {
  title: string
  subtitle: string
  stats: EnterAfter7dUntilNextStats | null
  sampleSize: { totalEvents: number; eligible7d: number } | null
}) {
  const winPct = stats?.winrate == null ? null : stats.winrate * 100
  const winTxt = winPct == null ? '—' : `${winPct.toFixed(0)}%`

  const winCls =
    winPct == null
      ? 'text-white/90'
      : winPct > 50
      ? 'text-green-200'
      : winPct < 50
      ? 'text-red-200'
      : 'text-white/90'

  return (
    <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-4">
      <div className="text-white/85 font-semibold">{title}</div>
      <div className="text-white/55 text-xs mt-1">{subtitle}</div>

      <div className="mt-3 rounded-xl bg-black/20 ring-1 ring-white/10 p-3">
        <div className="flex items-center justify-end">
          <div className="text-xs text-white/45">
            Included · {stats?.included ?? 0}
            {sampleSize
              ? ` (eligible ${sampleSize.eligible7d} / events ${sampleSize.totalEvents})`
              : ''}
          </div>
        </div>

        <div className={`text-lg font-extrabold mt-1 ${winCls}`}>{winTxt}</div>

        <div className="mt-1 grid grid-cols-2 gap-3 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-white/55">Avg</div>
            <div className={`font-semibold ${pctClassBySign(stats?.avg)}`}>{fmtPct(stats?.avg ?? null)}</div>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-white/55">Median</div>
            <div className={`font-semibold ${pctClassBySign(stats?.median)}`}>{fmtPct(stats?.median ?? null)}</div>
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-white/45">
        Directional: SELL “wins” when price drops. Entry is at signal+7d close, exit when status changes.
      </div>
    </div>
  )
}

export default function Crypto900Page({ stats, sampleSize, perCoin, fetchError }: PageProps) {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Crypto Past Performance (900d)</h1>
          <div className="text-xs text-white/60 mt-1">
            Historical backtest across all BUY/SELL transitions in the last ~900 daily candles.
          </div>
        </div>
        <Link href="/past-performance" className="text-sm text-white/70 hover:text-white">
          ← Back
        </Link>
      </div>

      {fetchError ? (
        <div className="mb-6 rounded-xl bg-red-500/10 ring-1 ring-red-400/30 p-4 text-red-200">
          Failed to load: {fetchError}
        </div>
      ) : null}

      <div className="mb-6 grid md:grid-cols-3 gap-4">
        <StatCardHistory
          title="Enter after 7d → Until next (closed)"
          subtitle="Historical win rate over ~900d. Enter 7 days after signal, exit on next status change."
          stats={stats}
          sampleSize={sampleSize}
        />
        <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-4">
          <div className="text-white/85 font-semibold">What this is</div>
          <div className="text-white/55 text-xs mt-1">
            This page replays every BUY/SELL transition per coin in the lookback window (not just the latest one).
          </div>
          <div className="mt-3 text-xs text-white/60 space-y-1">
            <div>• More trades = more reliable signal quality estimate.</div>
            <div>• Includes bull + bear regimes in that 900d window.</div>
            <div>• “Eligible” means: trade closed AND lasted ≥ 7d.</div>
          </div>
        </div>
        <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-4">
          <div className="text-white/85 font-semibold">Quick links</div>
          <div className="mt-3 text-xs">
            <Link className="text-white/70 hover:text-white underline" href="/past-performance/crypto">
              Latest (single-trade per coin) view
            </Link>
          </div>
        </div>
      </div>

      <section className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: '22%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '30%' }} />
          </colgroup>

          <thead className="bg-black/25 text-white/70">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-semibold">Coin</th>
              <th className="text-right px-3 py-2 text-xs font-semibold"># Events</th>
              <th className="text-right px-3 py-2 text-xs font-semibold">Closed</th>
              <th className="text-right px-3 py-2 text-xs font-semibold">Eligible 7d</th>
              <th className="text-right px-3 py-2 text-xs font-semibold">Winrate (7d→next)</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/10">
            {perCoin.map((r) => (
              <tr key={r.pair} className="hover:bg-white/[0.03] align-top">
                <td className="px-3 py-2">
                  <Link
                    href={`/crypto/${encodeURIComponent(String(r.coin || '').toLowerCase())}`}
                    className="text-white/90 font-semibold hover:text-white underline-offset-2 hover:underline"
                  >
                    {r.coin}
                  </Link>
                  <div className="text-xs text-white/50">{r.pair}</div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.nEvents}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.nClosed}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.nEligible7d}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span
                    className={
                      r.winrate7d == null
                        ? 'text-white/50'
                        : r.winrate7d > 0.5
                        ? 'text-green-200'
                        : r.winrate7d < 0.5
                        ? 'text-red-200'
                        : 'text-white/80'
                    }
                  >
                    {fmtWinRate01(r.winrate7d)}
                  </span>
                </td>
              </tr>
            ))}

            {!perCoin.length ? (
              <tr>
                <td className="px-3 py-6 text-white/60" colSpan={5}>
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

    const r = await fetch(`${baseUrl}/api/past-performance/crypto-history`, {
      headers: { accept: 'application/json' },
    })

    if (!r.ok) {
      return { props: { stats: null, sampleSize: null, perCoin: [], fetchError: `API error: ${r.status}` } }
    }

    const json = await r.json()

    const stats =
      json?.enterAfter7dUntilNextStats && typeof json.enterAfter7dUntilNextStats === 'object'
        ? (json.enterAfter7dUntilNextStats as EnterAfter7dUntilNextStats)
        : null

    const sampleSize =
      json?.sampleSize && typeof json.sampleSize === 'object'
        ? (json.sampleSize as { totalEvents: number; eligible7d: number })
        : null

    const perCoin = Array.isArray(json?.perCoin) ? (json.perCoin as PerCoin[]) : []

    return { props: { stats, sampleSize, perCoin, fetchError: null } }
  } catch (e: any) {
    return { props: { stats: null, sampleSize: null, perCoin: [], fetchError: e?.message || 'Failed to fetch' } }
  }
}