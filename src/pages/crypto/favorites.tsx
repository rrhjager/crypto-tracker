// src/pages/crypto/favorites.tsx
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { useSession, signIn } from 'next-auth/react'
import { COINS } from '@/lib/coins'
import { computeScoreStatus } from '@/lib/taScore'

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(r => r.json())

type FavItem = { kind?: string; symbol?: string }
type Status = 'BUY' | 'HOLD' | 'SELL'

function statusFromScore(score: number): Status {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}
function formatFiat(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (v >= 1000) return v.toLocaleString('nl-NL', { maximumFractionDigits: 0 })
  if (v >= 1) return v.toLocaleString('nl-NL', { maximumFractionDigits: 2 })
  return v.toLocaleString('nl-NL', { maximumFractionDigits: 6 })
}
const fmtPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`

function readLocalList(key: string | null): string[] {
  if (!key) return []
  try {
    const raw = localStorage.getItem(key)
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr.map(x => String(x || '').toUpperCase()).filter(Boolean)
  } catch {
    return []
  }
}

function writeLocalList(key: string | null, list: string[]) {
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {}
}

function emitFavsUpdated() {
  try {
    window.dispatchEvent(new Event('crypto-favs-updated'))
  } catch {}
}

// Binance-pair fallback voor indicators
const toBinancePair = (symbol: string) => {
  const s = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const skip = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD'])
  if (!s || skip.has(s)) return null
  return `${s}USDT`
}

// BTCUSDT / BTCUSD / BTC-USD / BTC/USD -> BTC (BASE ticker)
const toBaseTicker = (pairOrSym: string | null | undefined): string | null => {
  if (!pairOrSym) return null
  const clean = pairOrSym.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const base = clean.replace(/(USDT|USD|USDC|BUSD|FDUSD|TUSD)$/, '')
  return base || null
}

/* ===== types van je light-indicators API ===== */
type IndResp = {
  symbol: string // Binance pair, bv. BTCUSDT
  ma?: { ma50: number | null; ma200: number | null; cross: 'Golden Cross' | 'Death Cross' | '—' }
  rsi?: number | null
  macd?: { macd: number | null; signal: number | null; hist: number | null }
  volume?: { volume: number | null; avg20d: number | null; ratio: number | null }
  trend?: { ret20: number | null; rangePos20: number | null }
  volatility?: { stdev20: number | null; regime?: 'low' | 'med' | 'high' | '—' }
  perf?: { d: number | null; w: number | null; m: number | null }
}

/* ===== detail→home handshake (optioneel) ===== */
type LocalTA = { score: number; status: Status; ts: number }
const TA_KEY_PREFIX = 'ta:'
function readAllLocalTA(): Map<string, LocalTA> {
  if (typeof window === 'undefined') return new Map()
  const out = new Map<string, LocalTA>()
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || ''
      if (!k.startsWith(TA_KEY_PREFIX)) continue
      const sym = k.slice(TA_KEY_PREFIX.length)
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const obj = JSON.parse(raw)
      const score = Number(obj?.score)
      const status = (obj?.status as Status) || 'HOLD'
      const ts = Number(obj?.ts) || 0
      if (Number.isFinite(score) && (status === 'BUY' || status === 'HOLD' || status === 'SELL')) {
        out.set(sym, { score, status, ts })
      }
    }
  } catch {}
  return out
}

/* ===== kleine helpers ===== */
async function fetchJSON(url: string, { timeoutMs = 9000 } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/* ===== UI failsafe: haal prijs direct uit quotes of results, met meerdere matchpaden ===== */
function pickPx(pxData: any, baseSym: string, binance?: string) {
  // 1) rechtstreeks in quotes op BASE (BTC/ETH/…)
  const q1 = pxData?.quotes?.[baseSym]
  if (q1 && Number.isFinite(Number(q1.regularMarketPrice))) {
    return {
      price: Number(q1.regularMarketPrice),
      d: Number.isFinite(Number(q1.regularMarketChangePercent)) ? Number(q1.regularMarketChangePercent) : null,
    }
  }

  // 2) via base uit binance-pair (BTCUSDT -> BTC)
  const baseFromBinance = toBaseTicker(binance || '')
  const q2 = baseFromBinance ? pxData?.quotes?.[baseFromBinance] : undefined
  if (q2 && Number.isFinite(Number(q2.regularMarketPrice))) {
    return {
      price: Number(q2.regularMarketPrice),
      d: Number.isFinite(Number(q2.regularMarketChangePercent)) ? Number(q2.regularMarketChangePercent) : null,
    }
  }

  // 3) fallback naar results[]
  const results: Array<{ symbol: string; price: number | null; d: number | null }> = Array.isArray(pxData?.results)
    ? pxData.results
    : []

  // 3a) exact BASE
  let r = results.find(it => String(it.symbol || '').toUpperCase() === baseSym)
  // 3b) exact base van binance-pair
  const baseFromBinance2 = toBaseTicker(binance || '')
  if (!r && baseFromBinance2) {
    r = results.find(it => String(it.symbol || '').toUpperCase() === baseFromBinance2)
  }
  // 3c) vergelijk door elk result naar base om te zetten
  if (!r && results.length) {
    r = results.find(it => toBaseTicker(String(it.symbol)) === baseSym)
  }

  if (r && Number.isFinite(Number(r.price))) {
    return {
      price: Number(r.price),
      d: Number.isFinite(Number(r.d)) ? Number(r.d) : null,
    }
  }

  return { price: null as number | null, d: null as number | null }
}

function PageInner() {
  const { data: session, status } = useSession()
  const isAuthed = status === 'authenticated'

  const email = session?.user?.email ? String(session.user.email).toLowerCase() : null
  const localKey = email ? `faves:crypto:${email}` : null

  // favorites uit DB/API
  const favApiKey = isAuthed ? '/api/user/favorites?kind=CRYPTO' : null
  const { data, mutate, isLoading } = useSWR<{ favorites?: FavItem[] }>(favApiKey, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 15_000,
  })

  // ✅ local “instant” mirror (so updates from /crypto show immediately)
  const [localReady, setLocalReady] = useState(false)
  const [localList, setLocalList] = useState<string[]>([])

  useEffect(() => {
    if (!isAuthed || !localKey) {
      setLocalReady(false)
      setLocalList([])
      return
    }
    const list = readLocalList(localKey)
    setLocalList(list)
    setLocalReady(true)
  }, [isAuthed, localKey])

  // When API data arrives and we don't have local yet, seed localStorage (useful if user opens favorites first)
  useEffect(() => {
    if (!isAuthed || !localKey) return
    if (!data) return
    if (localReady) return

    const arr = Array.isArray(data?.favorites) ? data!.favorites : []
    const seeded = arr.map(it => String(it?.symbol || '').toUpperCase()).filter(Boolean)

    setLocalList(seeded)
    setLocalReady(true)
    writeLocalList(localKey, seeded)
    emitFavsUpdated()
  }, [isAuthed, localKey, data, localReady])

  // Listen for updates from other pages in the same tab
  useEffect(() => {
    if (!isAuthed || !localKey) return
    const onUpdate = () => {
      const list = readLocalList(localKey)
      setLocalList(list)
      setLocalReady(true)
      void mutate() // sync with server truth in background
    }
    window.addEventListener('crypto-favs-updated', onUpdate)
    return () => window.removeEventListener('crypto-favs-updated', onUpdate)
  }, [isAuthed, localKey, mutate])

  const effectiveSymbols = useMemo(() => {
    if (localReady) return new Set(localList.map(s => String(s || '').toUpperCase()).filter(Boolean))
    const arr = Array.isArray(data?.favorites) ? data!.favorites : []
    return new Set(arr.map(it => String(it?.symbol || '').toUpperCase()).filter(Boolean))
  }, [localReady, localList, data])

  const favCoins = useMemo(() => {
    return COINS.filter(c => effectiveSymbols.has(String(c.symbol || '').toUpperCase()))
  }, [effectiveSymbols])

  const toggleFav = useCallback(
    async (sym: string) => {
      if (!isAuthed) return
      const s = String(sym || '').toUpperCase()
      const currentlyFav = effectiveSymbols.has(s)

      // ✅ instant local update (for immediate UI + cross-page)
      const nextLocal = currentlyFav ? localList.filter(x => x !== s) : [s, ...localList.filter(x => x !== s)]
      setLocalList(nextLocal)
      setLocalReady(true)
      writeLocalList(localKey, nextLocal)
      emitFavsUpdated()

      // optimistic SWR update too
      await mutate(
        (prev) => {
          const prevArr = Array.isArray(prev?.favorites) ? prev!.favorites : []
          const nextArr = currentlyFav
            ? prevArr.filter(it => String(it?.symbol || '').toUpperCase() !== s)
            : [...prevArr, { kind: 'CRYPTO', symbol: s }]
          return { ...(prev || {}), favorites: nextArr }
        },
        { revalidate: false }
      )

      try {
        if (!currentlyFav) {
          const r = await fetch('/api/user/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'CRYPTO', symbol: s }),
          })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
        } else {
          const r = await fetch(`/api/user/favorites?kind=CRYPTO&symbol=${encodeURIComponent(s)}`, {
            method: 'DELETE',
          })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
        }
        await mutate()
      } catch {
        // rollback/sync
        await mutate()
        if (localKey) {
          const refreshed = readLocalList(localKey)
          setLocalList(refreshed)
          setLocalReady(true)
          emitFavsUpdated()
        }
      }
    },
    [isAuthed, effectiveSymbols, localList, localKey, mutate]
  )

  // ===== NEW (minimal): haal dezelfde data als /crypto voor alleen de favorites =====
  const [localTA, setLocalTA] = useState<Map<string, LocalTA>>(readAllLocalTA())
  useEffect(() => {
    function onStorage(ev: StorageEvent) {
      if (!ev.key || !ev.key.startsWith(TA_KEY_PREFIX)) return
      setLocalTA(new Map(readAllLocalTA()))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // 1) Base rows (zelfde velden als /crypto nodig heeft)
  const baseRows = useMemo(() => {
    return favCoins.map((c: any, i: number) => {
      const fromList = (c as any)?.pairUSD?.binance as string | null | undefined
      const fallback = toBinancePair(c.symbol)
      return {
        slug: (c.slug || String(c.symbol || '').toLowerCase()),
        symbol: c.symbol, // BTC/ETH/…
        name: c.name,
        binance: fromList || fallback, // voor indicators
        _rank: i,
      }
    })
  }, [favCoins])

  // 2) Indicators (via Binance-keys), batched elke 60s
  const binanceSymbols = useMemo(() => baseRows.map(r => r.binance).filter(Boolean) as string[], [baseRows])
  const [indBySym, setIndBySym] = useState<Map<string, IndResp>>(new Map())
  const [indUpdatedAt, setIndUpdatedAt] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (!binanceSymbols.length) return
    let aborted = false
    async function runOnce() {
      const groups = chunk(binanceSymbols, 12)
      await Promise.all(
        groups.map(async (group, gi) => {
          if (gi) await new Promise(r => setTimeout(r, 120 * gi))
          const url = `/api/crypto-light/indicators?symbols=${encodeURIComponent(group.join(','))}`
          try {
            const j = await fetchJSON(url, { timeoutMs: 9000 })
            const arr: IndResp[] = Array.isArray(j?.results) ? j.results : []
            if (aborted) return
            setIndBySym(prev => {
              const next = new Map(prev)
              for (const it of arr) next.set(it.symbol, it)
              return next
            })
            setIndUpdatedAt(Date.now())
          } catch {}
        })
      )
    }
    runOnce()
    const id = setInterval(runOnce, 60_000)
    return () => {
      aborted = true
      clearInterval(id)
    }
  }, [binanceSymbols])

  // 3) Prijzen (zelfde endpoint als /crypto)
  const tickers = useMemo(
    () => Array.from(new Set(baseRows.map(r => String(r.symbol || '').toUpperCase()))),
    [baseRows]
  )
  const { data: pxData } = useSWR<any>(
    tickers.length ? `/api/crypto-light/prices?symbols=${encodeURIComponent(tickers.join(','))}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 15_000 }
  )

  // 4) Rijen bouwen (zelfde berekening als /crypto)
  const rows = useMemo(() => {
    return baseRows.map(c => {
      const symU = String(c.symbol || '').toUpperCase()
      const ind = c.binance ? indBySym.get(c.binance) : undefined

      const calc = computeScoreStatus({
        ma: ind?.ma,
        rsi: ind?.rsi,
        macd: ind?.macd,
        volume: ind?.volume,
        trend: ind?.trend,
        volatility: ind?.volatility,
      } as any)
      let finalScore = Number(calc?.score ?? 50)
      let finalStatus: Status = statusFromScore(finalScore)

      // lokale override via binance-key
      const ta = c.binance ? localTA.get(c.binance) : undefined
      if (ta && Date.now() - ta.ts <= 10 * 60 * 1000) {
        if (Number.isFinite(ta.score)) finalScore = ta.score
        if (ta.status === 'BUY' || ta.status === 'HOLD' || ta.status === 'SELL') finalStatus = ta.status
      }

      const pxPicked = pickPx(pxData, symU, c.binance)
      const w = Number.isFinite(Number(ind?.perf?.w)) ? Number(ind?.perf?.w) : null
      const m = Number.isFinite(Number(ind?.perf?.m)) ? Number(ind?.perf?.m) : null

      return {
        ...c,
        _price: pxPicked.price,
        _d: pxPicked.d,
        _w: w,
        _m: m,
        _score: finalScore,
        status: finalStatus,
      }
    })
  }, [baseRows, indBySym, pxData, localTA])

  const updatedAt = indUpdatedAt || (pxData ? Date.now() : undefined)

  if (status === 'loading') {
    return (
      <main className="p-6 max-w-6xl mx-auto">
        <h1 className="hero">Crypto favorites</h1>
        <p className="sub">Loading…</p>
      </main>
    )
  }

  if (!session?.user) {
    return (
      <main className="p-6 max-w-6xl mx-auto">
        <h1 className="hero">Crypto favorites</h1>
        <p className="sub">Sign in to view your favorites.</p>

        <button
          onClick={() => signIn(undefined, { callbackUrl: '/crypto/favorites' })}
          className="mt-4 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-white/90 hover:bg-white/10 transition"
        >
          Sign in
        </button>
      </main>
    )
  }

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="hero">Crypto favorites</h1>
        <p className="sub">
          {isLoading ? 'Loading…' : `${favCoins.length} favorite${favCoins.length === 1 ? '' : 's'}`}
        </p>
      </header>

      <div className="table-card overflow-x-auto">
        {favCoins.length === 0 ? (
          <div className="p-4 text-white/70">
            You don’t have any crypto favorites yet. Go to{' '}
            <Link href="/crypto" className="link font-semibold">Crypto tracker</Link>{' '}
            and click the star.
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-white/60">
              <tr>
                <th className="text-left py-2">#</th>
                <th className="py-2 w-10 text-center">★</th>
                <th className="text-left py-2">Coin</th>
                <th className="text-right py-2">Prijs</th>
                <th className="text-right py-2">24h</th>
                <th className="text-right py-2">7d</th>
                <th className="text-right py-2">30d</th>
                <th className="text-right py-2">Status</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((c: any, i: number) => {
                const sym = String(c.symbol || '').toUpperCase()
                const slug = c.slug || sym.toLowerCase()

                const scoreNum = Number.isFinite(Number(c._score)) ? Math.round(Number(c._score)) : 50
                const statusByScore: Status = statusFromScore(scoreNum)
                const badgeCls =
                  statusByScore === 'BUY' ? 'badge-buy' : statusByScore === 'SELL' ? 'badge-sell' : 'badge-hold'

                return (
                  <tr key={sym} className="border-t border-white/5 hover:bg-white/5">
                    <td className="py-3 pr-3">{i + 1}</td>

                    <td className="py-3 w-10 text-center">
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggleFav(sym) }}
                        aria-pressed={true}
                        title="Remove from favorites"
                        className={[
                          'inline-flex items-center justify-center',
                          'h-6 w-6 rounded transition hover:bg-white/10',
                          'text-yellow-400',
                        ].join(' ')}
                      >
                        <span aria-hidden className="leading-none">★</span>
                      </button>
                    </td>

                    <td className="py-3">
                      <Link href={`/crypto/${slug}`} className="link font-semibold">
                        {c.name} <span className="ticker">({sym})</span>
                      </Link>
                    </td>

                    <td className="py-3 text-right">{c._price == null ? '—' : formatFiat(c._price)}</td>
                    <td className={`py-3 text-right ${Number(c._d ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmtPct(c._d)}</td>
                    <td className={`py-3 text-right ${Number(c._w ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmtPct(c._w)}</td>
                    <td className={`py-3 text-right ${Number(c._m ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmtPct(c._m)}</td>

                    <td className="py-3 text-right">
                      <button
                        type="button"
                        className={`${badgeCls} text-xs px-2 py-1 rounded`}
                        title={`Status: ${statusByScore} · Score: ${scoreNum}`}
                        aria-label={`Status ${statusByScore} met score ${scoreNum}`}
                      >
                        {statusByScore} · {scoreNum}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ✅ keep this available for parity if you ever want to show it (not changing layout) */}
      <div className="sr-only">
        Last update: {updatedAt ? new Date(updatedAt).toLocaleTimeString() : '—'}
      </div>
    </main>
  )
}

// Client-only om SSR/hydration gedoe te voorkomen in Pages Router
export default dynamic(() => Promise.resolve(PageInner), { ssr: false })
