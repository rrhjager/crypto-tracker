import { useMemo, useState } from 'react'
import useSWR from 'swr'

type Candidate = {
  symbol: string
  name: string
}

type Scenario = {
  key: 'baseline' | 'btc_relative' | 'breakout_squeeze' | 'confluence'
  label: string
  modelType: string
  probUp: number
  confidence: number
  expectedReturn: number | null
  edgeAfterCosts: number | null
  action: 'LONG' | 'HOLD' | 'EXIT'
  positionSize: number
  summary: string
  topReasons: string[]
  evaluation: {
    auc: number | null
    brier: number | null
    hitRate: number | null
    avgTradeReturnPct: number | null
    turnover: number | null
    compoundedValueOf100: number | null
  }
}

type CompareResp = {
  symbol: string
  assetType: 'crypto' | 'equity'
  horizon: 7 | 14 | 30
  regime: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL'
  benchmark: string | null
  featureSnapshot: {
    relBench20: number
    relBench60: number
    breakoutStrength: number
    atrPct14: number
    realizedVol20: number
    priceVs200dPct: number
    benchmarkTrend20: number
  }
  scenarios: Scenario[]
}

type Props = {
  candidates: Candidate[]
  horizon: 7 | 14 | 30
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(String(data?.error || `HTTP ${res.status}`))
  return data as CompareResp
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

function formatMoneyBase100(value: number | null | undefined) {
  if (!Number.isFinite(value as number)) return '-'
  return `€${Number(value).toFixed(2)}`
}

function actionTone(action: Scenario['action']) {
  if (action === 'LONG') return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
  if (action === 'EXIT') return 'border-rose-500/35 bg-rose-500/10 text-rose-900 dark:text-rose-200'
  return 'border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-200'
}

function valueTone(value: number | null | undefined) {
  if (!Number.isFinite(value as number)) return 'text-slate-900 dark:text-white'
  return Number(value) >= 0 ? 'text-emerald-900 dark:text-emerald-200' : 'text-rose-900 dark:text-rose-200'
}

function cardTone(key: Scenario['key']) {
  if (key === 'baseline') return 'border-slate-300/45 bg-white/80 dark:border-white/10 dark:bg-white/5'
  if (key === 'btc_relative') return 'border-cyan-300/45 bg-cyan-50/65 dark:border-cyan-500/25 dark:bg-cyan-950/10'
  if (key === 'breakout_squeeze') return 'border-violet-300/45 bg-violet-50/65 dark:border-violet-500/25 dark:bg-violet-950/10'
  return 'border-amber-300/45 bg-amber-50/65 dark:border-amber-500/25 dark:bg-amber-950/10'
}

export function CryptoScenarioCompare({ candidates, horizon }: Props) {
  const options = useMemo(() => {
    const seen = new Set<string>()
    const rows: Candidate[] = []
    for (const candidate of candidates) {
      const symbol = String(candidate.symbol || '').trim().toUpperCase()
      if (!symbol || seen.has(symbol)) continue
      seen.add(symbol)
      rows.push({ symbol, name: candidate.name })
    }
    return rows.slice(0, 6)
  }, [candidates])

  const [selected, setSelected] = useState<string>(options[0]?.symbol || '')

  const params = new URLSearchParams({
    symbol: selected || options[0]?.symbol || '',
    assetType: 'crypto',
    horizon: String(horizon),
  })

  const { data, error, isLoading } = useSWR<CompareResp>(
    selected || options[0]?.symbol ? `/api/forecast/compare?${params.toString()}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: 300_000,
      dedupingInterval: 60_000,
    }
  )

  if (!options.length) return null

  return (
    <section className="rounded-3xl border border-slate-300/45 bg-white/85 p-5 dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Crypto modelvergelijking</h2>
          <p className="mt-1 text-sm text-slate-700/80 dark:text-white/65">
            Vergelijk meerdere crypto-modellen op dezelfde coin: baseline, BTC-relative strength, breakout/squeeze en een strengere
            confluence-variant. Zo zie je welke aanpak netto de beste edge boven kosten geeft.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {options.map((candidate) => {
          const active = candidate.symbol === (selected || options[0]?.symbol)
          return (
            <button
              key={candidate.symbol}
              type="button"
              onClick={() => setSelected(candidate.symbol)}
              className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition ${
                active
                  ? 'border-cyan-500/40 bg-cyan-500/12 text-cyan-900 dark:text-cyan-200'
                  : 'border-slate-300/50 bg-white/70 text-slate-800 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-white'
              }`}
            >
              {candidate.symbol}
            </button>
          )
        })}
      </div>

      {isLoading ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
          Modelvergelijking laden...
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          Modelvergelijking kon niet laden: {error.message}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="mt-4 rounded-2xl border border-slate-300/45 bg-white/70 px-4 py-3 text-[12px] text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
            <span className="font-medium text-slate-900 dark:text-white">{data.symbol}</span> tegen benchmark{' '}
            <span className="font-medium text-slate-900 dark:text-white">{data.benchmark || 'n.v.t.'}</span>. Regime:{' '}
            <span className="font-medium text-slate-900 dark:text-white">{data.regime}</span>. Snapshot:{' '}
            rel20 {formatPct(data.featureSnapshot.relBench20)}, rel60 {formatPct(data.featureSnapshot.relBench60)}, breakout{' '}
            {data.featureSnapshot.breakoutStrength.toFixed(2)}, ATR {formatPct(data.featureSnapshot.atrPct14)}, vol20{' '}
            {formatPct(data.featureSnapshot.realizedVol20)}.
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {data.scenarios.map((scenario) => (
              <div key={scenario.key} className={`rounded-2xl border p-4 ${cardTone(scenario.key)}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-slate-900 dark:text-white">{scenario.label}</div>
                    <div className="mt-1 text-[11px] text-slate-700/75 dark:text-white/55">{scenario.modelType}</div>
                  </div>
                  <div className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${actionTone(scenario.action)}`}>
                    {scenario.action}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                    <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Prob up</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{formatProb(scenario.probUp)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                    <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Confidence</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{scenario.confidence}/100</div>
                  </div>
                  <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                    <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Exp. return</div>
                    <div className={`mt-1 text-sm font-semibold ${valueTone(scenario.expectedReturn)}`}>{formatPct(scenario.expectedReturn)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                    <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Net edge</div>
                    <div className={`mt-1 text-sm font-semibold ${valueTone(scenario.edgeAfterCosts)}`}>{formatPct(scenario.edgeAfterCosts)}</div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                    <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">AUC</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                      {scenario.evaluation.auc != null ? scenario.evaluation.auc.toFixed(3) : '-'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                    <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Hit rate</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                      {scenario.evaluation.hitRate != null ? formatPct(scenario.evaluation.hitRate * 100) : '-'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                    <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Avg trade</div>
                    <div className={`mt-1 text-sm font-semibold ${valueTone(scenario.evaluation.avgTradeReturnPct)}`}>
                      {formatPct(scenario.evaluation.avgTradeReturnPct)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-300/45 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                    <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">€100 comp.</div>
                    <div className={`mt-1 text-sm font-semibold ${valueTone((scenario.evaluation.compoundedValueOf100 ?? 100) - 100)}`}>
                      {formatMoneyBase100(scenario.evaluation.compoundedValueOf100)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 text-[12px] text-slate-700/80 dark:text-white/65">{scenario.summary}</div>
                <div className="mt-2 text-[12px] text-slate-700/80 dark:text-white/60">
                  Positiegrootte: {(scenario.positionSize * 100).toFixed(0)}% · Turnover:{' '}
                  {scenario.evaluation.turnover != null ? formatPct(scenario.evaluation.turnover * 100, 2) : '-'}
                </div>

                {scenario.topReasons.length ? (
                  <ul className="mt-3 space-y-1 text-[12px] text-slate-700/85 dark:text-white/70">
                    {scenario.topReasons.slice(0, 4).map((reason) => (
                      <li key={`${scenario.key}-${reason}`}>- {reason}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
