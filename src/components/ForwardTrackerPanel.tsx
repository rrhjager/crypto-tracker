import useSWR from 'swr'
import type { ForwardAssetType, ForwardSourceMode, ForwardTrackerResponse } from '@/lib/forwardTracker'

type Props = {
  assetType: ForwardAssetType
  sourceMode: ForwardSourceMode
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
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function formatDateTime(value: string) {
  const t = new Date(value)
  if (!Number.isFinite(t.getTime())) return '-'
  return t.toLocaleString('nl-NL')
}

function pnlClass(value: number) {
  if (value > 0) return 'text-emerald-900 dark:text-emerald-200'
  if (value < 0) return 'text-rose-900 dark:text-rose-200'
  return 'text-slate-900 dark:text-white'
}

function sidePill(side: 'BUY' | 'SELL') {
  return side === 'BUY'
    ? 'bg-emerald-600 text-white'
    : 'bg-rose-600 text-white'
}

export function ForwardTrackerPanel({ assetType, sourceMode }: Props) {
  const { data, error } = useSWR<ForwardTrackerResponse>(
    `/api/market/forward-tracker?assetType=${assetType}&sourceMode=${sourceMode}`,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: 3_600_000,
      dedupingInterval: 60_000,
    }
  )

  return (
    <section className="rounded-3xl border border-slate-300/45 bg-white/85 p-5 dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Forward test vanaf nu</h2>
          <p className="mt-1 text-sm text-slate-700/80 dark:text-white/65">
            Elke nieuwe {assetType === 'equity' ? 'aandelen' : 'crypto'}-status opent fictief een trade van{' '}
            <span className="font-medium text-slate-900 dark:text-white">€1000</span>.{' '}
            {assetType === 'equity'
              ? 'Aandelen sluiten alleen op een tegengesteld signaal, na bevestiging en minimaal 24 uur hold.'
              : 'Bij een statusflip of wanneer het signaal verdwijnt, sluit de trade automatisch.'}{' '}
            Bruto toont alleen de pure koersverandering. Netto trekt fees en slippage af.
          </p>
        </div>

        {data ? (
          <div className="rounded-2xl border border-slate-300/45 bg-white/75 px-4 py-3 text-right dark:border-white/10 dark:bg-white/5">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-600 dark:text-white/55">
              Sync
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{formatDateTime(data.meta.lastSyncAt)}</div>
            <div className="mt-1 text-[11px] text-slate-700/75 dark:text-white/55">
              Bron: {data.meta.sourceMode === 'audit' ? 'Audit' : data.meta.sourceMode === 'fallback' ? 'Fallback' : 'Live score'}
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          Forward test kon niet laden: {error.message}
        </div>
      ) : null}

      {!data && !error ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
          Forward test wordt geladen.
        </div>
      ) : null}

      {data ? (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-2xl border border-slate-300/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Open trades</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">{data.summary.openTrades}</div>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Gesloten trades</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">{data.summary.closedTrades}</div>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Gerealiseerd netto</div>
              <div className={`mt-1 text-2xl font-semibold ${pnlClass(data.summary.realizedNetPnlEur)}`}>
                {formatMoney(data.summary.realizedNetPnlEur)}
              </div>
              <div className={`mt-1 text-[11px] ${pnlClass(data.summary.realizedPnlEur)}`}>
                Bruto {formatMoney(data.summary.realizedPnlEur)}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Ongerealiseerd netto</div>
              <div className={`mt-1 text-2xl font-semibold ${pnlClass(data.summary.unrealizedNetPnlEur)}`}>
                {formatMoney(data.summary.unrealizedNetPnlEur)}
              </div>
              <div className={`mt-1 text-[11px] ${pnlClass(data.summary.unrealizedPnlEur)}`}>
                Bruto {formatMoney(data.summary.unrealizedPnlEur)}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Totaal netto</div>
              <div className={`mt-1 text-2xl font-semibold ${pnlClass(data.summary.totalNetPnlEur)}`}>
                {formatMoney(data.summary.totalNetPnlEur)}
              </div>
              <div className={`mt-1 text-[11px] ${pnlClass(data.summary.totalPnlEur)}`}>
                Bruto {formatMoney(data.summary.totalPnlEur)}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-300/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Winrate netto</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">
                {data.summary.winRateClosedNet == null ? '-' : formatPct(data.summary.winRateClosedNet * 100)}
              </div>
              <div className="mt-1 text-[11px] text-slate-700/75 dark:text-white/55">
                Bruto {data.summary.winRateClosed == null ? '-' : formatPct(data.summary.winRateClosed * 100)}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-300/45 bg-white/75 px-4 py-3 text-[12px] text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
            <span className="font-medium text-slate-900 dark:text-white">{data.meta.note}</span> Gestart op{' '}
            {formatDateTime(data.meta.startedAt)}. Nu open kapitaal: {formatMoney(data.summary.totalCommittedEur)}. Huidige signalen
            in de bronlaag: {data.meta.currentSignals}. Kostenmodel: {data.meta.costs.feeBpsRoundTrip} bps fee +{' '}
            {data.meta.costs.slippageBpsRoundTrip} bps slippage round-trip ({data.meta.costs.totalBpsRoundTrip} bps totaal). Totale
            kostendruk nu: {formatMoney(data.summary.totalCostsEur)}. De tracker wordt elk uur server-side ververst en synct ook
            opnieuw wanneer deze pagina opent.
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-300/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Nu open</h3>
                <span className="text-[11px] text-slate-700/75 dark:text-white/55">{data.openPositions.length} posities</span>
              </div>

              {data.openPositions.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
                  Er staan nog geen open paper-trades.
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {data.openPositions.map((position) => (
                    <div
                      key={`${position.symbol}-${position.side}-${position.openedAtMs}`}
                      className="rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">{position.symbol}</span>
                            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${sidePill(position.side)}`}>
                              {position.side === 'BUY' ? 'KOOP' : 'SHORT'}
                            </span>
                          </div>
                          <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">{position.name}</div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-right">
                          <div>
                            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-600 dark:text-white/50">
                              Bruto
                            </div>
                            <div className={`mt-1 text-sm font-semibold ${pnlClass(position.unrealizedPnlEur)}`}>
                              {formatMoney(position.unrealizedPnlEur)}
                            </div>
                            <div className={`text-[11px] ${pnlClass(position.unrealizedPnlEur)}`}>
                              {formatPct(position.unrealizedReturnPct)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-600 dark:text-white/50">
                              Netto
                            </div>
                            <div className={`mt-1 text-sm font-semibold ${pnlClass(position.unrealizedNetPnlEur)}`}>
                              {formatMoney(position.unrealizedNetPnlEur)}
                            </div>
                            <div className={`text-[11px] ${pnlClass(position.unrealizedNetPnlEur)}`}>
                              {formatPct(position.unrealizedNetReturnPct)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-600 dark:text-white/50">
                              Kosten
                            </div>
                            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                              {formatMoney(position.estimatedCostsEur)}
                            </div>
                            <div className="text-[11px] text-slate-700/75 dark:text-white/55">fees + slip</div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 text-[11px] dark:border-white/10 dark:bg-white/5">
                          <div className="text-slate-600 dark:text-white/55">Gestart</div>
                          <div className="mt-1 font-medium text-slate-900 dark:text-white">{formatDateTime(position.openedAt)}</div>
                        </div>
                        <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 text-[11px] dark:border-white/10 dark:bg-white/5">
                          <div className="text-slate-600 dark:text-white/55">Entry / nu</div>
                          <div className="mt-1 font-medium text-slate-900 dark:text-white">
                            {position.entryPrice.toFixed(4)} / {position.currentPrice.toFixed(4)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 text-[11px] dark:border-white/10 dark:bg-white/5">
                          <div className="text-slate-600 dark:text-white/55">Waarde nu</div>
                          <div className="mt-1 font-medium text-slate-900 dark:text-white">{formatMoney(position.currentValueEur)}</div>
                          <div className="mt-1 text-[10px] text-slate-700/75 dark:text-white/55">
                            Netto {formatMoney(position.netCurrentValueEur)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 text-[11px] dark:border-white/10 dark:bg-white/5">
                          <div className="text-slate-600 dark:text-white/55">Dagen open</div>
                          <div className="mt-1 font-medium text-slate-900 dark:text-white">{position.daysOpen.toFixed(1)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-300/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Recent gesloten</h3>
                <span className="text-[11px] text-slate-700/75 dark:text-white/55">{data.closedTrades.length} recent</span>
              </div>

              {data.closedTrades.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
                  Er zijn nog geen gesloten paper-trades sinds de start van deze tracker.
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {data.closedTrades.map((trade) => (
                    <div
                      key={`${trade.symbol}-${trade.side}-${trade.closedAtMs}`}
                      className="rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">{trade.symbol}</span>
                            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${sidePill(trade.side)}`}>
                              {trade.side === 'BUY' ? 'KOOP' : 'SHORT'}
                            </span>
                          </div>
                          <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">{trade.name}</div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-right">
                          <div>
                            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-600 dark:text-white/50">
                              Bruto
                            </div>
                            <div className={`mt-1 text-sm font-semibold ${pnlClass(trade.pnlEur)}`}>{formatMoney(trade.pnlEur)}</div>
                            <div className={`text-[11px] ${pnlClass(trade.pnlEur)}`}>{formatPct(trade.returnPct)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-600 dark:text-white/50">
                              Netto
                            </div>
                            <div className={`mt-1 text-sm font-semibold ${pnlClass(trade.netPnlEur)}`}>
                              {formatMoney(trade.netPnlEur)}
                            </div>
                            <div className={`text-[11px] ${pnlClass(trade.netPnlEur)}`}>{formatPct(trade.netReturnPct)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-600 dark:text-white/50">
                              Kosten
                            </div>
                            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                              {formatMoney(trade.costsEur)}
                            </div>
                            <div className="text-[11px] text-slate-700/75 dark:text-white/55">fees + slip</div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 text-[11px] dark:border-white/10 dark:bg-white/5">
                          <div className="text-slate-600 dark:text-white/55">Open / dicht</div>
                          <div className="mt-1 font-medium text-slate-900 dark:text-white">
                            {formatDateTime(trade.openedAt)} / {formatDateTime(trade.closedAt)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 text-[11px] dark:border-white/10 dark:bg-white/5">
                          <div className="text-slate-600 dark:text-white/55">Entry / exit</div>
                          <div className="mt-1 font-medium text-slate-900 dark:text-white">
                            {trade.entryPrice.toFixed(4)} / {trade.exitPrice.toFixed(4)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 text-[11px] dark:border-white/10 dark:bg-white/5">
                          <div className="text-slate-600 dark:text-white/55">Dagen open</div>
                          <div className="mt-1 font-medium text-slate-900 dark:text-white">{trade.daysOpen.toFixed(1)}</div>
                        </div>
                        <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 text-[11px] dark:border-white/10 dark:bg-white/5">
                          <div className="text-slate-600 dark:text-white/55">Exit</div>
                          <div className="mt-1 font-medium text-slate-900 dark:text-white">{trade.exitReason.replaceAll('_', ' ')}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
