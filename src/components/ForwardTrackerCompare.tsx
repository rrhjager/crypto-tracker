import useSWR from 'swr'
import type { ForwardTrackerResponse, ForwardSourceMode, ForwardStrategy } from '@/lib/forwardTracker'

type CompareRow = {
  label: string
  strategy: ForwardStrategy
}

type Props = {
  assetType: 'crypto'
  sourceMode: ForwardSourceMode
  rows: CompareRow[]
}

type CompareResult = {
  label: string
  strategy: ForwardStrategy
  data: ForwardTrackerResponse | null
  error: string | null
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(String(data?.error || `HTTP ${res.status}`))
  return data as ForwardTrackerResponse
}

function formatMoney(value: number | null | undefined) {
  if (!Number.isFinite(value as number)) return '-'
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(Number(value))
}

function formatPct(value: number | null | undefined) {
  if (!Number.isFinite(value as number)) return '-'
  const n = Number(value)
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

function pnlClass(value: number) {
  if (value > 0) return 'text-emerald-900 dark:text-emerald-200'
  if (value < 0) return 'text-rose-900 dark:text-rose-200'
  return 'text-slate-900 dark:text-white'
}

function cardTone(index: number) {
  if (index === 0) return 'border-sky-300/50 bg-sky-50/70 dark:border-sky-500/25 dark:bg-sky-950/10'
  if (index === 1) return 'border-emerald-300/50 bg-emerald-50/70 dark:border-emerald-500/25 dark:bg-emerald-950/10'
  return 'border-amber-300/50 bg-amber-50/70 dark:border-amber-500/25 dark:bg-amber-950/10'
}

export function ForwardTrackerCompare({ assetType, sourceMode, rows }: Props) {
  const key = `/api/market/forward-tracker/compare?assetType=${assetType}&sourceMode=${sourceMode}&rows=${encodeURIComponent(
    rows.map((row) => row.strategy).join(',')
  )}`

  const { data, error } = useSWR<CompareResult[]>(
    key,
    async () => {
      const results = await Promise.all(
        rows.map(async (row) => {
          try {
            const url = `/api/market/forward-tracker?assetType=${assetType}&sourceMode=${sourceMode}&strategy=${row.strategy}`
            const tracker = await fetcher(url)
            return { label: row.label, strategy: row.strategy, data: tracker, error: null }
          } catch (e: any) {
            return { label: row.label, strategy: row.strategy, data: null, error: String(e?.message || e) }
          }
        })
      )
      return results
    },
    {
      revalidateOnFocus: false,
      refreshInterval: 3_600_000,
      dedupingInterval: 60_000,
    }
  )

  return (
    <section className="rounded-3xl border border-slate-300/45 bg-white/85 p-5 dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Vergelijking forward tests</h2>
          <p className="mt-1 text-sm text-slate-700/80 dark:text-white/65">
            Compacte vergelijking van de drie crypto-varianten. Zo zie je direct welke variant netto het beste presteert.
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          Vergelijking kon niet laden: {error.message}
        </div>
      ) : null}

      {!data && !error ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
          Vergelijking wordt geladen.
        </div>
      ) : null}

      {data ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {data.map((row, index) => {
            const tracker = row.data
            const net = tracker?.summary.totalNetPnlEur ?? 0
            const gross = tracker?.summary.totalPnlEur ?? 0
            return (
              <div
                key={row.strategy}
                className={`rounded-2xl border p-4 ${cardTone(index)}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{row.label}</div>
                    <div className="mt-1 text-[11px] text-slate-700/75 dark:text-white/55">
                      {tracker ? `Bron: ${tracker.meta.sourceMode}` : 'Geen data'}
                    </div>
                  </div>
                  <div className={`text-right text-lg font-semibold ${pnlClass(net)}`}>
                    {tracker ? formatMoney(net) : '-'}
                    <div className={`text-[11px] font-medium ${pnlClass(gross)}`}>Bruto {tracker ? formatMoney(gross) : '-'}</div>
                  </div>
                </div>

                {row.error ? (
                  <div className="mt-3 text-sm text-rose-700 dark:text-rose-200">{row.error}</div>
                ) : tracker ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                    <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                      <div className="text-slate-600 dark:text-white/55">Winrate netto</div>
                      <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                        {tracker.summary.winRateClosedNet == null ? '-' : formatPct(tracker.summary.winRateClosedNet * 100)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                      <div className="text-slate-600 dark:text-white/55">Trades</div>
                      <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                        {tracker.summary.closedTrades} gesloten
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                      <div className="text-slate-600 dark:text-white/55">Open nu</div>
                      <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                        {tracker.summary.openTrades}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                      <div className="text-slate-600 dark:text-white/55">Signalen nu</div>
                      <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                        {tracker.meta.currentSignals}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
