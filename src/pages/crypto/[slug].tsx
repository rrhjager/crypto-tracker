import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/router'
import useSWR from 'swr'
import { useMemo, useEffect } from 'react'
import { COINS } from '@/lib/coins'
import TradingViewChart from '@/components/TradingViewChart'
import { overallScore, statusFromOverall, IndResp } from '@/lib/scoring' // ⬅️ unified scoring import

const fetcher = (u: string) => fetch(u).then(r => r.json())

type Status = 'BUY'|'HOLD'|'SELL'
const pill = (s: Status) =>
  s === 'BUY'  ? 'badge-buy'  :
  s === 'SELL' ? 'badge-sell' : 'badge-hold'

// Light-grey pill style for action links/buttons
const lightPill =
  "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm " +
  "bg-white/10 text-white/80 ring-1 ring-white/15 " +
  "hover:bg-white/15 hover:text-white transition";

// ====== Status-pills per kaart (ongewijzigd) ======
function statusMA(ma50?: number|null, ma200?: number|null): Status {
  if (ma50 == null || ma200 == null) return 'HOLD'
  if (ma50 > ma200) return 'BUY'
  if (ma50 < ma200) return 'SELL'
  return 'HOLD'
}
function statusRSI(r?: number|null): Status {
  if (r == null) return 'HOLD'
  if (r > 70) return 'SELL'
  if (r < 30) return 'BUY'
  return 'HOLD'
}
function statusMACD(h?: number|null): Status {
  if (h == null) return 'HOLD'
  if (h > 0) return 'BUY'
  if (h < 0) return 'SELL'
  return 'HOLD'
}
function statusVolume(ratio?: number|null): Status {
  if (ratio == null) return 'HOLD'
  if (ratio > 1.2) return 'BUY'
  if (ratio < 0.8) return 'SELL'
  return 'HOLD'
}

// Weergave helpers (ongewijzigd)
function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(d)
}
function formatFiat(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (v >= 1000) return v.toLocaleString('nl-NL', { maximumFractionDigits: 0 })
  if (v >= 1)    return v.toLocaleString('nl-NL', { maximumFractionDigits: 2 })
  return v.toLocaleString('nl-NL', { maximumFractionDigits: 6 })
}
function fmtInt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('nl-NL')
}

/* === Zelfde helpers als lijstpagina === */
// Binance-pair fallback: SYMBOL → SYMBOLUSDT (behalve stablecoins)
const toBinancePair = (symbol: string) => {
  const s = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const skip = new Set(['USDT','USDC','BUSD','DAI','TUSD'])
  if (!s || skip.has(s)) return null
  return `${s}USDT`
}

// Save TA naar localStorage zodat /crypto (overzicht) het kan oppakken
function saveLocalTA(symUSDT: string, score: number, status: Status) {
  try {
    localStorage.setItem(`ta:${symUSDT}`, JSON.stringify({ score, status, ts: Date.now() }))
    window.dispatchEvent(new StorageEvent('storage', { key: `ta:${symUSDT}`, newValue: localStorage.getItem(`ta:${symUSDT}`) }))
  } catch {}
}

function PageInner() {
  const { query } = useRouter()
  const slug = String(query.slug || '')
  const coin = useMemo(() => {
    const bySlug = COINS.find(c => (c.slug || c.symbol.toLowerCase()) === slug)
    if (bySlug) return bySlug
    return COINS.find(c => c.symbol.toLowerCase() === slug.toLowerCase())
  }, [slug])

  // Binance symbool (identiek aan overzicht) voor storage-sleutel
  const binanceFromList = (coin as any)?.pairUSD?.binance || null
  const binance = binanceFromList || (coin ? toBinancePair(coin.symbol) : null)

  // ===== TradingView symbol: voorkeur BINANCE, fallback OKX =====
  const tvSymbol = useMemo(() => {
    const base = (coin?.symbol || '').toUpperCase()
    if (binance) return `BINANCE:${binance}` // bv. BINANCE:VETUSDT
    if (base) return `OKX:${base}USDT`
    return 'BINANCE:BTCUSDT'
  }, [coin, binance])

  // Indicators (light endpoint)
  const { data } = useSWR<{ results: IndResp[] }>(
    binance ? `/api/crypto-light/indicators?symbols=${encodeURIComponent(binance)}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 120_000 }
  )
  const ind: IndResp | undefined = (data?.results || [])[0]
  const overall = overallScore(ind)

  // Prijs (uit Light prices-endpoint)
  const { data: pxData } = useSWR<{ results: { symbol:string, price:number|null }[] }>(
    binance ? `/api/crypto-light/prices?symbols=${encodeURIComponent(binance)}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 15_000 }
  )
  const price = pxData?.results?.[0]?.price ?? null

  // === Nieuws (Google News RSS via eigen API) ===
  const newsQuery = useMemo(() => {
    if (!coin) return null
    return `${coin.name} ${coin.symbol} crypto`
  }, [coin])

  const { data: newsData } = useSWR<{ items: { title: string; link: string; source?: string; pubDate?: string }[] }>(
    newsQuery ? `/api/news/google?q=${encodeURIComponent(newsQuery)}&hl=nl&gl=NL&ceid=NL:nl` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 300_000 }
  )

  // Schrijf score/status naar localStorage (voor de overzichtspagina)
  useEffect(() => {
    if (!binance) return
    const st = statusFromOverall(overall.score)
    saveLocalTA(binance, overall.score, st)
  }, [binance, overall.score])

  if (!coin) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <h1 className="hero">Niet gevonden</h1>
        <p className="sub mb-6">Deze coin bestaat niet in je COINS-lijst.</p>
        <Link href="/crypto" className={lightPill}>← Back to Crypto (light)</Link>
      </main>
    )
  }

  return (
    <main className="max-w-5xl mx-auto p-6">
      {/* Titel + symbol + PRIJS */}
      <h1 className="text-4xl font-extrabold tracking-tight text-white">{coin.name}</h1>
      <div className="text-white/70 text-lg">
        {coin.symbol}
      </div>
      <div className="mt-1 text-white/80">
        <span className="text-sm">Prijs:</span>{' '}
        <span className="font-semibold">{formatFiat(price)} </span>
        <span className="text-white/60 text-sm">(USD)</span>
      </div>

      {/* Totaal advies */}
      <section className="mt-6 mb-6">
        <div className="table-card p-4 flex items-center justify-between">
          <div className="font-semibold">Totaal advies</div>
          <span className={`${pill(statusFromOverall(overall.score))} text-sm`}>
            {statusFromOverall(overall.score)} · {overall.score}
          </span>
        </div>
      </section>

      {/* 2 x 2 grid met kaarten */}
      <section className="grid md:grid-cols-2 gap-4">
        {/* MA */}
        <div className="table-card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">MA50 vs MA200 (Golden/Death Cross)</h3>
            <span className={pill(statusMA(ind?.ma?.ma50 ?? null, ind?.ma?.ma200 ?? null))}>
              {statusMA(ind?.ma?.ma50 ?? null, ind?.ma?.ma200 ?? null)}
            </span>
          </div>
          <div className="text-white/80 text-sm">
            MA50: {fmtNum(ind?.ma?.ma50, 2)} — MA200: {fmtNum(ind?.ma?.ma200, 2)}
          </div>
        </div>

        {/* RSI */}
        <div className="table-card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">RSI (14)</h3>
            <span className={pill(statusRSI(ind?.rsi ?? null))}>
              {statusRSI(ind?.rsi ?? null)}
            </span>
          </div>
          <div className="text-white/80 text-sm">
            RSI: {fmtNum(ind?.rsi ?? null, 2)}
          </div>
        </div>

        {/* MACD */}
        <div className="table-card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">MACD (12/26/9)</h3>
            <span className={pill(statusMACD(ind?.macd?.hist ?? null))}>
              {statusMACD(ind?.macd?.hist ?? null)}
            </span>
          </div>
          <div className="text-white/80 text-sm">
            MACD: {fmtNum(ind?.macd?.macd ?? null, 4)} — Signaal: {fmtNum(ind?.macd?.signal ?? null, 4)} — Hist: {fmtNum(ind?.macd?.hist ?? null, 4)}
          </div>
        </div>

        {/* Volume */}
        <div className="table-card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">Volume vs 20d gemiddelde</h3>
            <span className={pill(statusVolume(ind?.volume?.ratio ?? null))}>
              {statusVolume(ind?.volume?.ratio ?? null)}
            </span>
          </div>
          <div className="text-white/80 text-sm">
            Volume: {fmtInt(ind?.volume?.volume ?? null)} — Gem.20d: {fmtInt(ind?.volume?.avg20d ?? null)} — Ratio: {fmtNum(ind?.volume?.ratio ?? null, 2)}
          </div>
        </div>
      </section>

      {/* TradingView Chart */}
      <section className="mt-6">
        <TradingViewChart
          tvSymbol={tvSymbol}
          height={480}
          theme="dark"
          interval="D"
          locale="nl_NL"
        />
      </section>

      {/* Google News blok */}
      <section className="mt-6">
        <div className="table-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Laatste nieuws</h3>
            {newsQuery ? (
              <a
                className="link text-sm"
                href={`https://news.google.com/search?q=${encodeURIComponent(newsQuery)}&hl=nl&gl=NL&ceid=NL:nl`}
                target="_blank" rel="noopener noreferrer"
              >
                Meer op Google News →
              </a>
            ) : null}
          </div>

          {!newsData && (
            <div className="text-white/60 text-sm">Nieuws laden…</div>
          )}

          {newsData?.items?.length ? (
            <ul className="space-y-3">
              {newsData.items.map((it, idx) => (
                <li key={idx} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 border-t border-white/5 pt-3 first:border-0 first:pt-0">
                  <a href={it.link} target="_blank" rel="noopener noreferrer" className="link font-medium">
                    {it.title}
                  </a>
                  <div className="text-xs text-white/60 sm:text-right">
                    {it.source ? <span>{it.source}</span> : null}
                    {it.pubDate ? <span className="ml-2">{new Date(it.pubDate).toLocaleString('nl-NL')}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : newsData && !newsData.items?.length ? (
            <div className="text-white/60 text-sm">Geen nieuws gevonden.</div>
          ) : null}
        </div>
      </section>

      {/* knoppen (EN + lichtgrijs) */}
      <section className="mt-6 flex gap-3">
        <Link href="/crypto" className={lightPill}>← Back to Crypto (light)</Link>
        <Link href="/" className={lightPill}>Go to homepage</Link>
      </section>
    </main>
  )
}

export default dynamic(() => Promise.resolve(PageInner), { ssr: false })