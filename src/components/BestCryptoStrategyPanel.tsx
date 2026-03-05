import useSWR from 'swr'
import type { ForwardSourceMode, ForwardStrategy, ForwardTrackerResponse } from '@/lib/forwardTracker'

type CompareRow = {
  label: string
  strategy: ForwardStrategy
}

type Props = {
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

function sideLabel(side: 'BUY' | 'SELL') {
  return side === 'BUY' ? 'KOOP' : 'SHORT'
}

export function BestCryptoStrategyPanel({ sourceMode, rows }: Props) {
  const key = `/api/market/forward-tracker/best?assetType=crypto&sourceMode=${sourceMode}&rows=${encodeURIComponent(
    rows.map((row) => row.strategy).join(',')
  )}`

  const { data, error } = useSWR<CompareResult[]>(
    key,
    async () => {
      const results = await Promise.all(
        rows.map(async (row) => {
          try {
            const url = `/api/market/forward-tracker?assetType=crypto&sourceMode=${sourceMode}&strategy=${row.strategy}`
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
      refreshInterval: 120_000,
      dedupingInterval: 15_000,
    }
  )

  const valid = (data || []).filter((row): row is CompareResult & { data: ForwardTrackerResponse } => !!row.data)
  const ranked = [...valid].sort((a, b) => {
    const aNet = a.data.summary.totalNetPnlEur
    const bNet = b.data.summary.totalNetPnlEur
    if (bNet !== aNet) return bNet - aNet

    const aRealized = a.data.summary.realizedNetPnlEur
    const bRealized = b.data.summary.realizedNetPnlEur
    if (bRealized !== aRealized) return bRealized - aRealized

    const aWin = a.data.summary.winRateClosedNet ?? -1
    const bWin = b.data.summary.winRateClosedNet ?? -1
    if (bWin !== aWin) return bWin - aWin

    return b.data.summary.closedTrades - a.data.summary.closedTrades
  })

  const best = ranked[0]
  const hasMeaningfulHistory = valid.some(
    (row) =>
      row.data.summary.closedTrades > 0 ||
      row.data.summary.openTrades > 0 ||
      Math.abs(row.data.summary.totalNetPnlEur) > 0.0001
  )
  const bestWinrateValue = valid
    .filter((row) => row.data.summary.closedTrades > 0 && row.data.summary.winRateClosedNet != null)
    .reduce((max, row) => Math.max(max, row.data.summary.winRateClosedNet ?? -1), -1)
  const profitableRows = valid.filter((row) => row.data.summary.totalNetPnlEur > 0)
  const lowestProfitableCost =
    profitableRows.length > 0
      ? profitableRows.reduce((min, row) => Math.min(min, row.data.summary.totalCostsEur), Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY
  const winningReasons =
    best && hasMeaningfulHistory
      ? [
          'Hoogste totale netto resultaat van alle actieve crypto-varianten.',
          best.data.summary.realizedNetPnlEur >= Math.max(...valid.map((row) => row.data.summary.realizedNetPnlEur))
            ? 'Ook de hoogste gerealiseerde netto winst tot nu toe.'
            : null,
          best.data.summary.closedTrades > 0 &&
          best.data.summary.winRateClosedNet != null &&
          best.data.summary.winRateClosedNet >= bestWinrateValue
            ? 'Ook de beste netto winrate van de varianten met gesloten trades.'
            : null,
          best.data.summary.totalNetPnlEur > 0 && best.data.summary.totalCostsEur <= lowestProfitableCost
            ? 'Laagste kostendruk binnen de momenteel winstgevende varianten.'
            : null,
          best.data.summary.closedTrades >= Math.max(...valid.map((row) => row.data.summary.closedTrades))
            ? 'Deze variant heeft ook de grootste afgesloten sample binnen de huidige set.'
            : null,
        ].filter((reason): reason is string => !!reason)
      : []

  return (
    <section
      id="beste-strategie"
      className="rounded-3xl border border-emerald-300/45 bg-emerald-50/70 p-5 dark:border-emerald-500/25 dark:bg-emerald-950/10"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Meest winstgevende strategie nu</h2>
          <p className="mt-1 text-sm text-slate-700/80 dark:text-white/65">
            Dit blok vergelijkt alle crypto-forwardtests hierboven en pakt de variant met het hoogste totale netto resultaat
            (gerealiseerd + open).
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          Beste strategie kon niet laden: {error.message}
        </div>
      ) : null}

      {!data && !error ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
          Beste strategie wordt geladen.
        </div>
      ) : null}

      {data && (!best || !hasMeaningfulHistory) ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
          Er is nog geen duidelijke winnaar. De strategieën hebben nog geen betekenisvolle tradehistorie opgebouwd.
        </div>
      ) : null}

      {best ? (
        <div className="mt-4 rounded-2xl border border-slate-300/45 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-900/70 dark:text-emerald-200/70">
                Huidige winnaar
              </div>
              <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{best.label}</div>
              <div className="mt-1 text-[12px] text-slate-700/75 dark:text-white/55">
                Bron: {best.data.meta.sourceMode === 'audit' ? 'Audit' : best.data.meta.sourceMode === 'fallback' ? 'Fallback' : 'Live score'}
              </div>
            </div>
            <div className={`text-right text-2xl font-semibold ${pnlClass(best.data.summary.totalNetPnlEur)}`}>
              {formatMoney(best.data.summary.totalNetPnlEur)}
              <div className={`mt-1 text-[11px] font-medium ${pnlClass(best.data.summary.totalPnlEur)}`}>
                Bruto {formatMoney(best.data.summary.totalPnlEur)}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] text-slate-600 dark:text-white/55">Gerealiseerd netto</div>
              <div className={`mt-1 text-lg font-semibold ${pnlClass(best.data.summary.realizedNetPnlEur)}`}>
                {formatMoney(best.data.summary.realizedNetPnlEur)}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] text-slate-600 dark:text-white/55">Open netto</div>
              <div className={`mt-1 text-lg font-semibold ${pnlClass(best.data.summary.unrealizedNetPnlEur)}`}>
                {formatMoney(best.data.summary.unrealizedNetPnlEur)}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] text-slate-600 dark:text-white/55">Winrate netto</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                {best.data.summary.winRateClosedNet == null ? '-' : formatPct(best.data.summary.winRateClosedNet * 100)}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] text-slate-600 dark:text-white/55">Trades</div>
              <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                {best.data.summary.closedTrades} gesloten / {best.data.summary.openTrades} open
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
            Deze variant staat nu bovenaan omdat hij het hoogste totale netto resultaat heeft binnen de actieve crypto-scenario’s.
            {best.data.openPositions[0]
              ? ` De huidige open positie is ${best.data.openPositions[0].symbol} (${sideLabel(best.data.openPositions[0].side)}).`
              : ' Er staat nu geen open positie in deze strategie.'}
          </div>

          {winningReasons.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-600 dark:text-white/55">
                Waarom deze wint
              </div>
              <ul className="mt-3 space-y-1 text-sm text-slate-700 dark:text-white/70">
                {winningReasons.map((reason) => (
                  <li key={reason}>- {reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
