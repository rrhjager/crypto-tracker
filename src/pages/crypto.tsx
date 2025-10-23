// src/pages/crypto.tsx
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import useSWR from 'swr'
import { COINS } from '@/lib/coins'
import { computeScoreStatus } from '@/lib/taScore'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type Status = 'BUY' | 'HOLD' | 'SELL'
type StatusFilter = 'ALL' | 'BUY' | 'HOLD' | 'SELL'
type SortKey = 'fav' | 'coin' | 'price' | 'd' | 'w' | 'm' | 'status'
type SortDir = 'asc' | 'desc'

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
  (v == null || !Number.isFinite(Number(v))) ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`

// Binance-pair fallback voor indicators
const toBinancePair = (symbol: string) => {
  const s = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const skip = new Set(['USDT','USDC','BUSD','DAI','TUSD','FDUSD'])
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
  ma?: { ma50: number|null; ma200: number|null; cross: 'Golden Cross'|'Death Cross'|'—' }
  rsi?: number|null
  macd?: { macd: number|null; signal: number|null; hist: number|null }
  volume?: { volume: number|null; avg20d: number|null; ratio: number|null }
  perf?: { d: number|null; w: number|null; m: number|null }
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
  const results: Array<{symbol:string, price:number|null, d:number|null}> =
    Array.isArray(pxData?.results) ? pxData.results : []

  // 3a) exact BASE
  let r = results.find(it => String(it.symbol || '').toUpperCase() === baseSym)
  // 3b) exact base van binance-pair
  if (!r && baseFromBinance) {
    r = results.find(it => String(it.symbol || '').toUpperCase() === baseFromBinance)
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

/* ===================== PAGE ===================== */
function PageInner() {
  // 1) Basisrijen (Binance pair alleen voor indicators)
  const baseRows = useMemo(() => {
    return COINS.slice(0, 50).map((c, i) => {
      const fromList = (c as any)?.pairUSD?.binance as string | null | undefined
      const fallback = toBinancePair(c.symbol)
      return {
        slug: (c.slug || c.symbol.toLowerCase()),
        symbol: c.symbol,              // pure ticker (BTC/ETH/…)
        name: c.name,
        binance: fromList || fallback, // voor indicators fetch
        _rank: i,
        _price: null as number | null,
        _d: null as number | null,
        _w: null as number | null,
        _m: null as number | null,
        _score: 50,
        status: 'HOLD' as Status,
        _fav: false,
      }
    })
  }, [])

  // 2) Favorieten
  const [faves, setFaves] = useState<string[]>([])
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('faves') : null
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) setFaves(arr.map((s: any) => String(s).toUpperCase()))
      }
    } catch {}
  }, [])
  function toggleFav(sym: string) {
    const s = String(sym || '').toUpperCase()
    setFaves(prev => {
      const next = prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
      try { localStorage.setItem('faves', JSON.stringify(next)) } catch {}
      return next
    })
  }

  // 3) (optioneel) localStorage TA
  const [localTA, setLocalTA] = useState<Map<string, LocalTA>>(readAllLocalTA())
  useEffect(() => {
    function onStorage(ev: StorageEvent) {
      if (!ev.key || !ev.key.startsWith(TA_KEY_PREFIX)) return
      setLocalTA(new Map(readAllLocalTA()))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // 4) Indicators (via Binance-keys), batched elke 60s
  const binanceSymbols = useMemo(() => baseRows.map(r => r.binance).filter(Boolean) as string[], [baseRows])
  const [indBySym, setIndBySym] = useState<Map<string, IndResp>>(new Map())
  const [indUpdatedAt, setIndUpdatedAt] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (!binanceSymbols.length) return
    let aborted = false
    async function runOnce() {
      const groups = chunk(binanceSymbols, 12)
      await Promise.all(groups.map(async (group, gi) => {
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
      }))
    }
    runOnce()
    const id = setInterval(runOnce, 60_000)
    return () => { aborted = true; clearInterval(id) }
  }, [binanceSymbols])

  // 5) Prijzen (direct per ticker → API normaliseert en limiteert tot 60)
  const tickers = useMemo(
    () => Array.from(new Set(baseRows.map(r => String(r.symbol || '').toUpperCase()))),
    [baseRows]
  )
  const { data: pxData } = useSWR<any>(
    tickers.length ? `/api/crypto-light/prices?symbols=${encodeURIComponent(tickers.join(','))}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 15_000 }
  )

  // --- zichtbare debug (eenmalig controleren in console) ---
  useEffect(() => {
    // Verwijder gerust later: bevestigt dat prijzen daadwerkelijk binnenkomen
    console.log('DEBUG pxData', pxData)
  }, [pxData])

  // 6) Sorting
  const [sortKey, setSortKey] = useState<SortKey>('coin')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(nextKey); if (nextKey === 'coin') setSortDir('asc'); else if (nextKey === 'fav') setSortDir('desc'); else setSortDir('desc') }
  }

  // 7) Rijen bouwen (gebruik pickPx om prijs robuust te vinden)
  const rows = useMemo(() => {
    const list = baseRows.map((c) => {
      const symU = String(c.symbol || '').toUpperCase()
      const ind  = c.binance ? indBySym.get(c.binance) : undefined

      const calc = computeScoreStatus({ ma: ind?.ma, rsi: ind?.rsi, macd: ind?.macd, volume: ind?.volume } as any)
      let finalScore = Number(calc?.score ?? 50)
      let finalStatus: Status = statusFromScore(finalScore)

      // lokale override via binance-key
      const ta = c.binance ? localTA.get(c.binance) : undefined
      if (ta && (Date.now() - ta.ts) <= 10 * 60 * 1000) {
        if (Number.isFinite(ta.score)) finalScore = ta.score
        if (ta.status === 'BUY' || ta.status === 'HOLD' || ta.status === 'SELL') finalStatus = ta.status
      }

      const pxPicked = pickPx(pxData, symU, c.binance) // 🔑 hier de robuuste prijs
      const w = Number.isFinite(Number(ind?.perf?.w)) ? Number(ind?.perf?.w) : null
      const m = Number.isFinite(Number(ind?.perf?.m)) ? Number(ind?.perf?.m) : null

      return {
        ...c,
        _fav: faves.includes(symU),
        _score: finalScore,
        status: finalStatus,
        _price: pxPicked.price,
        _d: pxPicked.d,
        _w: w,
        _m: m,
      }
    })

    const dir = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'fav':   return ((a._fav === b._fav) ? 0 : a._fav ? 1 : -1) * dir
        case 'coin':  return (a._rank - b._rank) * dir
        case 'price':
          if (a._price == null && b._price == null) return 0
          if (a._price == null) return 1
          if (b._price == null) return -1
          return (a._price - b._price) * dir
        case 'd':     return ((a._d ?? -Infinity) - (b._d ?? -Infinity)) * dir
        case 'w':     return ((a._w ?? -Infinity) - (b._w ?? -Infinity)) * dir
        case 'm':     return ((a._m ?? -Infinity) - (b._m ?? -Infinity)) * dir
        case 'status':return (a._score - b._score) * dir
        default:      return 0
      }
    })
  }, [baseRows, faves, sortKey, sortDir, indBySym, pxData, localTA]) // ⬅ pxData toegevoegd

  const updatedAt = indUpdatedAt || (pxData ? Date.now() : undefined)

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="hero">Crypto Tracker (light)</h1>
          <p className="sub">Laatste update: {updatedAt ? new Date(updatedAt).toLocaleTimeString() : '—'}</p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <div className="table-card overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-white/60">
                <tr>
                  <th className="text-left py-2">#</th>
                  <th className="py-2 w-10 text-center">
                    <button onClick={() => toggleSort('fav')} title="Sorteren op favoriet"
                      className="mx-auto flex h-6 w-6 items-center justify-center rounded hover:bg-white/10 text-white/70 hover:text-white transition">
                      <span className="leading-none">⭐</span>
                      <span className="sr-only">Favoriet</span>
                    </button>
                  </th>
                  <th className="text-left py-2">
                    <button onClick={() => toggleSort('coin')} className="inline-flex items-center gap-1 hover:text-white transition">Coin</button>
                  </th>
                  <th className="text-right py-2">
                    <button onClick={() => toggleSort('price')} className="inline-flex items-center gap-1 hover:text-white transition w-full justify-end">Prijs</button>
                  </th>
                  <th className="text-right py-2">
                    <button onClick={() => toggleSort('d')} className="inline-flex items-center gap-1 hover:text-white transition w-full justify-end">24h</button>
                  </th>
                  <th className="text-right py-2">
                    <button onClick={() => toggleSort('w')} className="inline-flex items-center gap-1 hover-text-white transition w-full justify-end">7d</button>
                  </th>
                  <th className="text-right py-2">
                    <button onClick={() => toggleSort('m')} className="inline-flex items-center gap-1 hover:text-white transition w-full justify-end">30d</button>
                  </th>
                  <th className="text-right py-2">
                    <button onClick={() => toggleSort('status')} className="inline-flex items-center gap-1 hover:text-white transition w-full justify-end">Status</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c: any, i: number) => {
                  const sym = String(c.symbol || '').toUpperCase()
                  const isFav = c._fav === true
                  const scoreNum = Number.isFinite(Number(c._score)) ? Math.round(Number(c._score)) : 50
                  const statusByScore: Status = statusFromScore(scoreNum)
                  const badgeCls =
                    statusByScore === 'BUY' ? 'badge-buy' :
                    statusByScore === 'SELL' ? 'badge-sell' : 'badge-hold'

                  return (
                    <tr key={c.slug || c.symbol || i} className="border-t border-white/5 hover:bg-white/5">
                      <td className="py-3 pr-3">{i + 1}</td>
                      <td className="py-3 w-10 text-center">
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFav(sym) }}
                          aria-pressed={isFav}
                          title={isFav ? 'Verwijder uit favorieten' : 'Markeer als favoriet'}
                          className={[
                            'inline-flex items-center justify-center',
                            'h-5 w-5 rounded hover:bg-white/10 transition',
                            isFav ? 'text-yellow-400' : 'text-white/40 hover:text-yellow-300',
                          ].join(' ')}
                        >
                          <span aria-hidden className="leading-none">{isFav ? '★' : '☆'}</span>
                        </button>
                      </td>
                      <td className="py-3">
                        <Link href={`/crypto/${c.slug}`} className="link font-semibold">
                          {c.name} <span className="ticker">({c.symbol})</span>
                        </Link>
                      </td>

                      <td className="py-3 text-right">
                        {c._price == null
                          ? <span className="text-white/50">— (geen prijs voor {c.symbol})</span>
                          : formatFiat(c._price)}
                      </td>
                      <td className={`py-3 text-right ${Number(c._d ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmtPct(c._d)}</td>

                      <td className={`py-3 text-right ${Number(c._w ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmtPct(c._w)}</td>
                      <td className={`py-3 text-right ${Number(c._m ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmtPct(c._m)}</td>
                      <td className="py-3 text-right">
                        <button type="button" className={`${badgeCls} text-xs px-2 py-1 rounded`}
                          title={`Status: ${statusByScore} · Score: ${scoreNum}`}
                          aria-label={`Status ${statusByScore} met score ${scoreNum}`}>
                          {statusByScore} · {scoreNum}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* RECHTS */}
        <div className="lg:col-span-4">
          <div className="sticky top-6 space-y-6">
            <AISummary rows={rows} updatedAt={updatedAt} />
            <DailySummary rows={rows} updatedAt={updatedAt} />
            <Heatmap rows={rows} />
          </div>
        </div>
      </div>
    </main>
  )
}

// Client-only om SSR/hydration gedoe te voorkomen in Pages Router
export default dynamic(() => Promise.resolve(PageInner), { ssr: false })