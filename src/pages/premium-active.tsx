import Head from 'next/head'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { HC_MARKET_META } from '@/lib/highConfidence'
import type { PremiumActiveResponse, PremiumSignal } from '@/lib/premiumActive'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || ''

type Props = {
  data: PremiumActiveResponse | null
  error: string | null
  thresholdPct: 70 | 80
}

const fmtRatioPct = (v: number | null | undefined, d = 1) =>
  Number.isFinite(v as number) ? `${((v as number) * 100).toFixed(d)}%` : '-'
const fmtRetPct = (v: number | null | undefined, d = 2) =>
  Number.isFinite(v as number) ? `${(Number(v) >= 0 ? '+' : '')}${Number(v).toFixed(d)}%` : '-'

function marketTypeLabel(item: PremiumSignal) {
  return item.market === 'CRYPTO' ? 'Crypto' : 'Aandeel'
}

function actionCopy(item: PremiumSignal) {
  if (item.status === 'BUY') return 'Kopen of vasthouden zolang dit signaal actief blijft.'
  return 'Niet kopen, of uitstappen als je deze al hebt.'
}

function SignalCard({
  item,
  tone,
}: {
  item: PremiumSignal
  tone: 'buy' | 'sell'
}) {
  const isBuy = tone === 'buy'

  return (
    <Link
      href={item.href}
      className={`block rounded-2xl border p-4 transition ${
        isBuy
          ? 'border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/15'
          : 'border-rose-400/40 bg-rose-500/10 hover:bg-rose-500/15'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-slate-900 dark:text-white">{item.symbol}</span>
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                isBuy ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
              }`}
            >
              {isBuy ? 'KOOP NU' : 'VERKOOP / UITSTAPPEN'}
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-800 dark:text-white/85">{item.name}</div>
          <div className="mt-1 text-[11px] text-slate-700/75 dark:text-white/60">
            {marketTypeLabel(item)} • {HC_MARKET_META[item.market].label}
          </div>
        </div>

        <div className="rounded-2xl border border-white/30 bg-white/70 px-3 py-2 text-right dark:border-white/10 dark:bg-white/10">
          <div className="text-[10px] font-medium text-slate-600 dark:text-white/55">Historisch filter</div>
          <div className={`text-sm font-semibold ${isBuy ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200'}`}>
            {fmtRatioPct(item.validationWinrate)}
          </div>
          <div className="text-[11px] text-slate-700/75 dark:text-white/60">{fmtRetPct(item.validationReturnPct)}</div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-white/35 bg-white/65 px-3 py-2 text-[12px] text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-white/75">
        {actionCopy(item)}
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-700/70 dark:text-white/55">
        <span className="rounded-full border border-slate-300/45 bg-white/70 px-2 py-1 dark:border-white/10 dark:bg-white/5">
          Gebaseerd op {item.validationTrades} vergelijkbare signalen
        </span>
        <span className="rounded-full border border-slate-300/45 bg-white/70 px-2 py-1 dark:border-white/10 dark:bg-white/5">
          Update live
        </span>
      </div>
    </Link>
  )
}

function ActionSection({
  title,
  subtitle,
  tone,
  items,
  emptyText,
}: {
  title: string
  subtitle: string
  tone: 'buy' | 'sell'
  items: PremiumSignal[]
  emptyText: string
}) {
  const isBuy = tone === 'buy'

  return (
    <section
      className={`rounded-3xl border p-5 ${
        isBuy
          ? 'border-emerald-400/35 bg-white/80 dark:border-emerald-500/30 dark:bg-white/5'
          : 'border-rose-400/35 bg-white/80 dark:border-rose-500/30 dark:bg-white/5'
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className={`text-xl font-semibold ${isBuy ? 'text-emerald-900 dark:text-emerald-200' : 'text-rose-900 dark:text-rose-200'}`}>
            {title}
          </h2>
          <p className="text-sm text-slate-700/80 dark:text-white/65">{subtitle}</p>
        </div>
        <div
          className={`rounded-2xl px-4 py-2 text-center ${
            isBuy ? 'bg-emerald-500/15 text-emerald-900 dark:text-emerald-200' : 'bg-rose-500/15 text-rose-900 dark:text-rose-200'
          }`}
        >
          <div className="text-[10px] uppercase tracking-[0.12em] opacity-75">Nu live</div>
          <div className="text-2xl font-semibold">{items.length}</div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300/60 bg-white/60 px-4 py-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
          {emptyText}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <SignalCard key={`premium-${item.market}-${item.symbol}-${item.status}`} item={item} tone={tone} />
          ))}
        </div>
      )}
    </section>
  )
}

function parseThreshold(raw: string | string[] | undefined): 70 | 80 {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === '70' ? 70 : 80
}

export default function PremiumActivePage({ data, error, thresholdPct }: Props) {
  const generatedAt = data?.meta?.generatedAt ? new Date(data.meta.generatedAt).toLocaleString('nl-NL') : '-'
  const allSignals = data?.signals?.all || []
  const buySignals = (data?.signals?.buy || []).filter((item) => item.status === 'BUY')
  const sellSignals = (data?.signals?.sell || []).filter((item) => item.status === 'SELL')
  const activeThreshold = Math.round((data?.meta?.targetWinrate ?? thresholdPct / 100) * 100) as 70 | 80
  const thresholdOptions: Array<{ value: 70 | 80; title: string; blurb: string }> = [
    { value: 70, title: '70% filter', blurb: 'Meer signalen, bredere lijst' },
    { value: 80, title: '80% filter', blurb: 'Strenger, meest selectief' },
  ]
  const equityBuys = buySignals.filter((item) => item.market !== 'CRYPTO').length
  const cryptoBuys = buySignals.filter((item) => item.market === 'CRYPTO').length

  return (
    <>
      <Head>
        <title>Premium Signals | SignalHub</title>
        <meta
          name="description"
          content="Duidelijke premium koopsignalen en uitstapsignalen. Groen betekent kopen of vasthouden, rood betekent uitstappen."
        />
      </Head>

      <main className="max-w-screen-xl mx-auto px-4 pt-10 pb-16 space-y-6">
        <section className="rounded-3xl border border-amber-300/45 bg-gradient-to-br from-amber-50 via-orange-50 to-emerald-50 p-6 shadow-[0_20px_60px_-28px_rgba(245,158,11,0.35)] dark:border-amber-500/30 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-slate-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="max-w-3xl">
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Premium Signals</h1>
              <p className="mt-2 text-sm text-slate-800/85 dark:text-white/75">
                Dit is de simpele handelslijst: groen betekent kopen of vasthouden, rood betekent niet kopen of uitstappen.
                Verdwijnt een naam uit deze lijst, dan sluit je de positie.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/high-confidence"
                className="rounded-full border border-slate-400/35 bg-white/70 px-4 py-2 text-[12px] font-medium text-slate-800 hover:bg-white dark:border-white/20 dark:bg-white/10 dark:text-white"
              >
                Open gratis signalen
              </Link>
              <Link
                href="/"
                className="rounded-full border border-amber-500/35 bg-amber-500/10 px-4 py-2 text-[12px] font-medium text-amber-900 hover:bg-amber-500/20 dark:text-amber-200"
              >
                Terug naar home
              </Link>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/45 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Nu kopen</div>
              <div className="mt-1 text-3xl font-semibold text-emerald-900 dark:text-emerald-200">{buySignals.length}</div>
              <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">
                {equityBuys} aandelen en {cryptoBuys} crypto
              </div>
            </div>

            <div className="rounded-2xl border border-white/45 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Nu uitstappen</div>
              <div className="mt-1 text-3xl font-semibold text-rose-900 dark:text-rose-200">{sellSignals.length}</div>
              <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">
                Deze namen koop je nu niet
              </div>
            </div>

            <div className="rounded-2xl border border-white/45 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Actieve filter</div>
              <div className="mt-1 text-3xl font-semibold text-slate-900 dark:text-white">{activeThreshold}%</div>
              <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Update {generatedAt}</div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {thresholdOptions.map((option) => {
              const isActive = option.value === activeThreshold
              return (
                <Link
                  key={option.value}
                  href={option.value === 80 ? '/premium-active' : `/premium-active?threshold=${option.value}`}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    isActive
                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-200'
                      : 'border-slate-400/35 bg-white/70 text-slate-800 hover:bg-white dark:border-white/20 dark:bg-white/10 dark:text-white'
                  }`}
                >
                  <div className="text-[12px] font-semibold">{option.title}</div>
                  <div className="text-[11px] opacity-80">{option.blurb}</div>
                </Link>
              )
            })}
          </div>
        </section>

        {error && (
          <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            Fout bij laden van premium signals: {error}
          </section>
        )}

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-300/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Stap 1</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Zie je groen?</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Dan koop je die naam, of je houdt hem vast als je hem al hebt.</div>
          </div>

          <div className="rounded-2xl border border-slate-300/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Stap 2</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Zie je rood?</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Dan koop je niet bij, of je sluit de positie als je die al hebt.</div>
          </div>

          <div className="rounded-2xl border border-slate-300/45 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="text-[11px] font-medium text-slate-600 dark:text-white/55">Stap 3</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Verdwijnt de naam?</div>
            <div className="mt-1 text-[12px] text-slate-700/80 dark:text-white/60">Dan is het signaal klaar en sluit je die trade.</div>
          </div>
        </section>

        <ActionSection
          title="Koop nu"
          subtitle="Dit zijn de enige namen die je nu actief mag kopen of vasthouden volgens deze filter."
          tone="buy"
          items={buySignals}
          emptyText="Er zijn op dit moment geen actieve koopkansen binnen deze filter."
        />

        <ActionSection
          title="Verkoop / uitstappen"
          subtitle="Deze namen koop je nu niet. Heb je ze al, dan is dit het moment om uit te stappen."
          tone="sell"
          items={sellSignals}
          emptyText="Er zijn op dit moment geen actieve uitstapsignalen binnen deze filter."
        />

        <section className="rounded-2xl border border-slate-300/45 bg-white/75 p-4 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
          Deze pagina toont alleen live signalen die door de geselecteerde premium-filter komen. Technische details zijn bewust naar de achtergrond
          gebracht, zodat de lijst direct te volgen is.
          <span className="ml-1 font-medium text-slate-900 dark:text-white">Totaal live: {allSignals.length}</span>
        </section>
      </main>
    </>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  const thresholdPct = parseThreshold(context.query.threshold)
  const targetWinrate = thresholdPct / 100

  try {
    const base =
      process.env.NODE_ENV === 'development'
        ? 'http://localhost:3000'
        : (BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'))

    const r = await fetch(
      `${base}/api/market/premium-active?targetWinrate=${targetWinrate}&minCoverage=0.12&minTrades=8&minValidationTrades=6`,
      { cache: 'no-store' }
    )
    if (!r.ok) return { props: { data: null, error: `HTTP ${r.status}`, thresholdPct } }

    const data = (await r.json()) as PremiumActiveResponse
    return { props: { data, error: null, thresholdPct } }
  } catch (e: any) {
    return { props: { data: null, error: e?.message || 'Failed to fetch', thresholdPct } }
  }
}
