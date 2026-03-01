import useSWR from 'swr'

type ForecastPanelProps = {
  symbol: string
  assetType: 'equity' | 'crypto'
  horizon: 7 | 14 | 30
  marketHint?: string | null
}

type ForecastResp = {
  probUp: number
  confidence: number
  expectedReturn: number | null
  predictionInterval?: { p10: number | null; p50: number | null; p90: number | null }
  positionSize: number
  action: 'LONG' | 'HOLD' | 'EXIT'
  regime: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL'
  topReasons: string[]
  evaluation?: {
    classification?: {
      auc: number | null
      brier: number | null
      logLoss: number | null
    }
    strategy?: {
      hitRate: number | null
      avgTradeReturnPct: number | null
      turnover: number | null
    }
  }
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  return data as ForecastResp
}

function formatPct(value: number | null | undefined, digits = 1) {
  if (!Number.isFinite(value as number)) return '-'
  const n = Number(value)
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

function formatProb(value: number | null | undefined) {
  if (!Number.isFinite(value as number)) return '-'
  return `${(Number(value) * 100).toFixed(1)}%`
}

function actionTone(action: ForecastResp['action']) {
  if (action === 'LONG') return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
  if (action === 'EXIT') return 'border-rose-500/35 bg-rose-500/10 text-rose-900 dark:text-rose-200'
  return 'border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-200'
}

function regimeTone(regime: ForecastResp['regime']) {
  if (regime === 'RISK_ON') return 'bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
  if (regime === 'RISK_OFF') return 'bg-rose-500/10 text-rose-900 dark:text-rose-200'
  return 'bg-slate-500/10 text-slate-900 dark:text-white/80'
}

export function ForecastPanel({ symbol, assetType, horizon, marketHint }: ForecastPanelProps) {
  const params = new URLSearchParams({
    symbol,
    assetType,
    horizon: String(horizon),
  })
  if (marketHint) params.set('market', marketHint)

  const { data, error, isLoading } = useSWR(`/api/forecast?${params.toString()}`, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 300_000,
  })

  if (isLoading) {
    return (
      <div className="mt-4 rounded-2xl border border-slate-300/45 bg-white/70 p-4 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/70">
        Forecast laden...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mt-4 rounded-2xl border border-rose-500/35 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-200">
        Forecast tijdelijk niet beschikbaar.
      </div>
    )
  }

  const reasons = Array.isArray(data.topReasons) ? data.topReasons.slice(0, 4) : []

  return (
    <div className="mt-4 rounded-2xl border border-slate-300/45 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-600 dark:text-white/55">Forecast {horizon}D</div>
          <div className="mt-1 text-base font-semibold text-slate-900 dark:text-white">{formatProb(data.probUp)} omhoogkans</div>
        </div>
        <div className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${actionTone(data.action)}`}>{data.action}</div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Confidence</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{data.confidence}/100</div>
        </div>
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Expected return</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{formatPct(data.expectedReturn)}</div>
        </div>
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Position size</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{(data.positionSize * 100).toFixed(0)}%</div>
        </div>
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Regime</div>
          <div className={`mt-1 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${regimeTone(data.regime)}`}>{data.regime}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">AUC</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
            {data.evaluation?.classification?.auc != null ? data.evaluation.classification.auc.toFixed(3) : '-'}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Hit rate</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
            {data.evaluation?.strategy?.hitRate != null ? formatPct(data.evaluation.strategy.hitRate * 100) : '-'}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Turnover</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
            {data.evaluation?.strategy?.turnover != null ? formatPct(data.evaluation.strategy.turnover * 100) : '-'}
          </div>
        </div>
      </div>

      {data.predictionInterval && (
        <div className="mt-3 text-[11px] text-slate-700/80 dark:text-white/60">
          Verwachte range: {formatPct(data.predictionInterval.p10)} / {formatPct(data.predictionInterval.p50)} / {formatPct(data.predictionInterval.p90)}
        </div>
      )}

      {reasons.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px] text-slate-700/85 dark:text-white/70">
          {reasons.map((reason) => (
            <li key={reason}>- {reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
