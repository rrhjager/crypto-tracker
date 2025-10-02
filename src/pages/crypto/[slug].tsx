// src/pages/crypto/[slug].tsx
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/router'
import useSWR from 'swr'
import { useMemo, useEffect } from 'react'
import { COINS } from '@/lib/coins'
import TradingViewChart from '@/components/TradingViewChart' // TV widget

// >>> Belangrijk: zelfde types + scorefunctie als de homepage <<<
import {
  computeCompositeScore,
  statusFromScore,
  type Advice,
  type MaCrossResp,
  type RsiResp,
  type MacdResp,
  type Vol20Resp,
} from '@/lib/score'

type IndHeavy = {
  ma: MaCrossResp | null
  rsi: RsiResp | null
  macd: MacdResp | null
  vol: Vol20Resp | null
  error?: string
}

const fetcher = (u: string) => fetch(u).then(r => r.json())

type Status = Advice
const pill = (s: Status) =>
  s === 'BUY'  ? 'badge-buy'  :
  s === 'SELL' ? 'badge-sell' : 'badge-hold'

// Light-grey pill style for action links/buttons
const lightPill =
  "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm " +
  "bg-white/10 text-white/80 ring-1 ring-white/15 " +
  "hover:bg-white/15 hover:text-white transition";

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

/* === Helpers identiek aan overzicht === */
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
    // event sturen zodat open tabbladen meteen refreshen
    window.dispatchEvent(new StorageEvent('storage', { key: `ta:${symUSDT}`, newValue: localStorage.getItem(`ta:${symUSDT}`) }))
  } catch {}
}

/* =============== HEAVY INDICATORS (zelfde bron als homepage) =============== */
/** Haal de 4 indicator endpoints op voor een Yahoo-style symbool (bv 'VET-USD') */
async function fetchHeavyIndicators(symbol: string): Promise<IndHeavy> {
  try {
    const [rMa, rRsi, rMacd, rVol] = await Promise.all([
      fetch(`/api/indicators/ma-cross/${encodeURIComponent(symbol)}`, { cache: 'no-store' }),
      fetch(`/api/indicators/rsi/${encodeURIComponent(symbol)}?period=14`, { cache: 'no-store' }),
      fetch(`/api/indicators/macd/${encodeURIComponent(symbol)}?fast=12&slow=26&signal=9`, { cache: 'no-store' }),
      fetch(`/api/indicators/vol20/${encodeURIComponent(symbol)}?period=20`, { cache: 'no-store' }),
    ])

    const ma  = rMa.ok  ? await rMa.json()  as MaCrossResp : null
    const rsi = rRsi.ok ? await rRsi.json() as RsiResp    : null
    const macd= rMacd.ok? await rMacd.json()as MacdResp   : null
    const vol = rVol.ok ? await rVol.json() as Vol20Resp  : null

    return { ma, rsi, macd, vol }
  } catch (e:any) {
    return { ma: null, rsi: null, macd: null, vol: null, error: String(e?.message || e) }
  }
}

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

function PageInner() {
  const { query } = useRouter()
  const slug = String(query.slug || '')
  const coin = useMemo(() => {
    const bySlug = COINS.find(c => (c.slug || c.symbol.toLowerCase()) === slug)
    if (bySlug) return bySlug
    return COINS.find(c => c.symbol.toLowerCase() === slug.toLowerCase())
  }, [slug])

  // Binance symbool voor TV en storage-sleutel
  const binanceFromList = (coin as any)?.pairUSD?.binance || null
  const binance = binanceFromList || (coin ? toBinancePair(coin.symbol) : null)

  // ===== TradingView symbol: voorkeur BINANCE, fallback OKX =====
  const tvSymbol = useMemo(() => {
    const base = (coin?.symbol || '').toUpperCase()
    if (binance) return `BINANCE:${binance}` // bv. BINANCE:VETUSDT
    if (base) return `OKX:${base}USDT`      // fallback dekt veel pairs
    return 'BINANCE:BTCUSDT'
  }, [coin, binance])

  /* --------- INDICATORS: ZELFDE BRON ALS HOMEPAGE --------- */
  // Let op: we gebruiken HIER het Yahoo-style symbool (bv 'VET-USD'), net als de homepage.
  const yahooSymbol = coin?.symbol || null

  const { data: heavy, error: heavyErr } = useSWR<IndHeavy>(
    yahooSymbol ? ['heavy-ind', yahooSymbol] : null,
    () => fetchHeavyIndicators(yahooSymbol as string),
    { revalidateOnFocus: false, refreshInterval: 120_000 }
  )

  // Totaalscore: exact dezelfde functie als homepage
  const overallScore = useMemo(() => {
    if (!heavy) return { score: 50, status: 'HOLD' as Status }
    const score = computeCompositeScore(heavy.ma, heavy.macd, heavy.rsi, heavy.vol)
    return { score, status: statusFromScore(score) }
  }, [heavy])

  /* --------- PRIJS (ongewijzigd: light endpoint) --------- */
  const { data: pxData } = useSWR<{ results: { symbol:string, price:number|null }[] }>(
    binance ? `/api/crypto-light/prices?symbols=${encodeURIComponent(binance)}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 15_000 }
  )
  const price = pxData?.results?.[0]?.price ?? null

  /* --------- Nieuws (ongewijzigd) --------- */
  const newsQuery = useMemo(() => {
    if (!coin) return null
    return `${coin.name} ${coin.symbol} crypto`
  }, [coin])

  const { data: newsData } = useSWR<{ items: { title: string; link: string; source?: string; pubDate?: string }[] }>(
    newsQuery ? `/api/news/google?q=${encodeURIComponent(newsQuery)}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 300_000 }
  )

  // Schrijf score/status naar localStorage (voor de overzichtspagina /crypto)
  useEffect(() => {
    if (!binance) return
    saveLocalTA(binance, overallScore.score, overallScore.status)
  }, [binance, overallScore.score, overallScore.status])

  if (!coin) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <h1 className="hero">Niet gevonden</h1>
        <p className="sub mb-6">Deze coin bestaat niet in je COINS-lijst.</p>
        <Link href="/crypto" className={lightPill}>← Back to Crypto (light)</Link>
      </main>
    )
  }

  // Uitpakken voor de detailkaarten
  const ma50   = heavy?.ma?.ma50 ?? null
  const ma200  = heavy?.ma?.ma200 ?? null
  const rsi    = heavy?.rsi?.rsi ?? null
  const hist   = heavy?.macd?.hist ?? null
  const vol    = heavy?.vol?.volume ?? null
  const avg20d = heavy?.vol?.avg20 ?? null
  const ratio  = heavy?.vol?.ratio ?? null

  return (
    <main className="max-w-5xl mx-auto p-6">
      {/* Titel + symbol + PRIJS */}
      <h1 className="text-4xl font-extrabold tracking-tight text-white">{coin.name}</h1>
      <div className="text-white/70 text-lg">{coin.symbol}</div>
      <div className="mt-1 text-white/80">
        <span className="text-sm">Prijs:</span>{' '}
        <span className="font-semibold">{formatFiat(price)} </span>
        <span className="text-white/60 text-sm">(USD)</span>
      </div>

      {/* Totaal advies — zelfde berekening als homepage */}
      <section className="mt-6 mb-6">
        <div className="table-card p-4 flex items-center justify-between">
          <div className="font-semibold">Totaal advies</div>
          <span className={`${pill(overallScore.status)} text-sm`}>
            {overallScore.status} · {overallScore.score}
          </span>
        </div>
        {heavyErr && (
          <div className="text-xs text-red-300 mt-2">
            Fout bij laden van indicatoren: {String(heavyErr)}
          </div>
        )}
      </section>

      {/* 2 x 2 grid met kaarten (weergave gelijk gehouden) */}
      <section className="grid md:grid-cols-2 gap-4">
        {/* MA */}
        <div className="table-card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">MA50 vs MA200 (Golden/Death Cross)</h3>
            <span className={pill(statusMA(ma50, ma200))}>
              {statusMA(ma50, ma200)}
            </span>
          </div>
          <div className="text-white/80 text-sm">
            MA50: {fmtNum(ma50, 6)} — MA200: {fmtNum(ma200, 6)}
          </div>
        </div>

        {/* RSI */}
        <div className="table-card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">RSI (14)</h3>
            <span className={pill(statusRSI(rsi))}>
              {statusRSI(rsi)}
            </span>
          </div>
          <div className="text-white/80 text-sm">
            RSI: {fmtNum(rsi, 2)}
          </div>
        </div>

        {/* MACD */}
        <div className="table-card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">MACD (12/26/9)</h3>
            <span className={pill(statusMACD(hist))}>
              {statusMACD(hist)}
            </span>
          </div>
          <div className="text-white/80 text-sm">
            MACD: {fmtNum(heavy?.macd?.macd ?? null, 6)} — Signaal: {fmtNum(heavy?.macd?.signal ?? null, 6)} — Hist: {fmtNum(hist ?? null, 6)}
          </div>
        </div>

        {/* Volume */}
        <div className="table-card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">Volume vs 20d gemiddelde</h3>
            <span className={pill(statusVolume(ratio))}>
              {statusVolume(ratio)}
            </span>
          </div>
          <div className="text-white/80 text-sm">
            Volume: {fmtInt(vol)} — Gem.20d: {fmtInt(avg20d)} — Ratio: {fmtNum(ratio, 2)}
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