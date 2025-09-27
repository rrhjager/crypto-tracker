// src/pages/crypto.tsx
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import useSWR from 'swr'
import { COINS } from '@/lib/coins'
import ScoreBadge from '@/components/ScoreBadge' // blijft staan, maar we tonen nu status-badge

// ---------- helpers ----------
const fetcher = (url: string) => fetch(url).then(r => r.json())

function formatFiat(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (v >= 1000) return v.toLocaleString('nl-NL', { maximumFractionDigits: 0 })
  if (v >= 1)    return v.toLocaleString('nl-NL', { maximumFractionDigits: 2 })
  return v.toLocaleString('nl-NL', { maximumFractionDigits: 6 })
}
const fmtPct = (v: number | null | undefined) =>
  (v == null || !Number.isFinite(Number(v))) ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`

type Status = 'BUY'|'HOLD'|'SELL'
type StatusFilter = 'ALL' | 'BUY' | 'HOLD' | 'SELL'
function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)) }
function colorStops(status: Status, score: number) {
  const s = clamp(score, 0, 100)
  let hue = 38, sat = 70, light = 42
  if (status === 'BUY')  { hue = 142; sat = 65; light = 44 - 12 * clamp((s - 66) / 34, 0, 1) }
  if (status === 'SELL') { hue = 0;   sat = 70; light = 44 - 12 * clamp((33 - s) / 33, 0, 1) }
  const c1 = `hsl(${hue} ${sat}% ${light}%)`
  const c2 = `hsl(${hue} ${sat}% ${clamp(light + 8, 20, 62)}%)`
  return { c1, c2 }
}
function statusFromScore(score: number): Status {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

// Binance-pair fallback (voor Vercel): maak SYMBOLUSDT behalve voor stablecoins
const toBinancePair = (symbol: string) => {
  const s = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const skip = new Set(['USDT','USDC','BUSD','DAI','TUSD'])
  if (!s || skip.has(s)) return null
  return `${s}USDT`
}

// ---------- scoring op 4 indicatoren ----------
type IndResp = {
  symbol: string
  ma?: { ma50: number|null; ma200: number|null; cross: 'Golden Cross'|'Death Cross'|'—' }
  rsi?: number|null
  macd?: { macd: number|null; signal: number|null; hist: number|null }
  volume?: { volume: number|null; avg20d: number|null; ratio: number|null }
  // NIEUW: door backend meegeleverd (optioneel)
  score?: number
  status?: Status
  error?: string
}

function scoreFromIndicators(ind?: IndResp): { score: number, status: Status } {
  if (!ind || ind.error) return { score: 50, status: 'HOLD' }

  // MA (35%)
  let maScore = 50
  if (ind.ma?.ma50 != null && ind.ma?.ma200 != null) {
    if (ind.ma.ma50 > ind.ma.ma200) {
      const spread = clamp(ind.ma.ma50 / Math.max(1e-9, ind.ma.ma200) - 1, 0, 0.2)
      maScore = 60 + (spread / 0.2) * 40
    } else if (ind.ma.ma50 < ind.ma.ma200) {
      const spread = clamp(ind.ma.ma200 / Math.max(1e-9, ind.ma.ma50) - 1, 0, 0.2)
      maScore = 40 - (spread / 0.2) * 40
    } else {
      maScore = 50
    }
  }

  // RSI (25%)
  let rsiScore = 50
  if (typeof ind.rsi === 'number') rsiScore = clamp(((ind.rsi - 30) / 40) * 100, 0, 100)

  // MACD (25%)
  let macdScore = 50
  const hist = ind.macd?.hist
  if (typeof hist === 'number') macdScore = hist > 0 ? 70 : hist < 0 ? 30 : 50

  // Volume (15%)
  let volScore = 50
  const ratio = ind.volume?.ratio
  if (typeof ratio === 'number') volScore = clamp((ratio / 2) * 100, 0, 100)

  const score = Math.round(clamp(
    0.35 * maScore + 0.25 * rsiScore + 0.25 * macdScore + 0.15 * volScore,
    0, 100
  ))
  return { score, status: statusFromScore(score) }
}

/* ====== NIEUW: detail→home localStorage handshake ====== */
type LocalTA = { score: number; status: Status; ts: number }
const TA_KEY_PREFIX = 'ta:' // sleutels zoals ta:BTCUSDT

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

function saveLocalTA(symUSDT: string, score: number, status: Status) {
  try {
    const k = `${TA_KEY_PREFIX}${symUSDT}`
    localStorage.setItem(k, JSON.stringify({ score, status, ts: Date.now() }))
    // evt. notify — sommige browsers propagaten 'storage' alleen tussen tabs
    window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: localStorage.getItem(k) }))
  } catch {}
}

// ---------- rechterkolom ----------
function AISummary({ rows, updatedAt }: { rows: any[], updatedAt?: number }) {
  if (!rows?.length) return null
  const total = rows.length
  const buy = rows.filter(r => r.status === 'BUY').length
  const sell = rows.filter(r => r.status === 'SELL').length
  const buyPct = Math.round((buy / total) * 100)
  const sellPct = Math.round((sell / total) * 100)
  const greenPct = Math.round((rows.filter(r => (r._d ?? 0) >= 0).length / total) * 100)
  const avgScore = Math.round(rows.reduce((s, r) => s + (r._score ?? 0), 0) / Math.max(1, total))
  const avgD = rows.reduce((s, r) => s + (r._d ?? 0), 0) / Math.max(1, total)

  let bias: 'Bullish' | 'Bearish' | 'Neutraal' = 'Neutraal'
  if ((buyPct - sellPct) >= 10 || avgScore >= 58 || avgD >= 0.5) bias = 'Bullish'
  if ((sellPct - buyPct) >= 10 || avgScore <= 42 || avgD <= -0.5) bias = 'Bearish'

  const biasCls = bias === 'Bullish' ? 'badge-buy' : bias === 'Bearish' ? 'badge-sell' : 'badge-hold'

  return (
    <aside className="table-card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold">AI-advies (markt)</h3>
        <div className="text-xs text-white/60">Stand: {updatedAt ? new Date(updatedAt).toLocaleTimeString() : '—'}</div>
      </div>
      <div className="text-sm mb-3">
        <span className={`${biasCls} mr-2`}>{bias}</span>
        <span className="text-white/80">BUY {buyPct}% · SELL {sellPct}% · 24h groen {greenPct}%</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-white/70">
        <span className="px-2 py-1 rounded bg-white/5 ring-1 ring-white/10">Gem. score <b className="text-white/90">{avgScore}</b></span>
        <span className="px-2 py-1 rounded bg-white/5 ring-1 ring-white/10">Gem. 24h <b className={`text-white/90 ${avgD >= 0 ? 'text-green-300' : 'text-red-300'}`}>{avgD >= 0 ? '+' : ''}{avgD.toFixed(2)}%</b></span>
      </div>
    </aside>
  )
}

function DailySummary({ rows, updatedAt }: { rows: any[], updatedAt?: number }) {
  if (!rows?.length) return null
  const total = rows.length
  const buy = rows.filter(r => r.status === 'BUY').length
  const hold = rows.filter(r => r.status === 'HOLD').length
  const sell = rows.filter(r => r.status === 'SELL').length
  const pct = (n: number) => Math.round((n / Math.max(1, total)) * 100)

  const avgScore = Math.round(rows.reduce((s, r) => s + (r._score ?? 0), 0) / Math.max(1, total))
  const greenPct = pct(rows.filter(r => (r._d ?? 0) >= 0).length)

  const byScore = [...rows].sort((a,b)=> (b._score ?? 0) - (a._score ?? 0))
  const topUp = byScore.slice(0, Math.min(3, byScore.length))
  const topDown = [...byScore].reverse().slice(0, Math.min(3, byScore.length))

  return (
    <aside className="table-card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold">Dagelijkse samenvatting</h3>
        <div className="text-xs text-white/60">Stand: {updatedAt ? new Date(updatedAt).toLocaleTimeString() : '—'}</div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10">
          <div className="text-[10px] text-white/70 mb-1">BUY</div>
          <div className="flex items-end justify-between"><div className="text-lg font-bold text-green-300">{pct(buy)}%</div><div className="text-xs text-white/60">{buy}/{total}</div></div>
        </div>
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10">
          <div className="text-[10px] text-white/70 mb-1">HOLD</div>
          <div className="flex items-end justify-between"><div className="text-lg font-bold text-amber-300">{pct(hold)}%</div><div className="text-xs text-white/60">{hold}/{total}</div></div>
        </div>
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10">
          <div className="text-[10px] text-white/70 mb-1">SELL</div>
          <div className="flex items-end justify-between"><div className="text-lg font-bold text-red-300">{pct(sell)}%</div><div className="text-xs text-white/60">{sell}/{total}</div></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10"><div className="text-[10px] text-white/70 mb-1">Breadth (24h groen)</div><div className="text-lg font-bold">{greenPct}%</div></div>
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10"><div className="text-[10px] text-white/70 mb-1">Gem. score</div><div className="text-lg font-bold">{avgScore}</div></div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10">
          <div className="text-[10px] text-white/70 mb-1">Top scores</div>
          <ul className="space-y-1">
            {topUp.map((r) => (
              <li key={`up-${r.slug}`} className="flex items-center justify-between text-xs">
                <span className="font-semibold">{r.symbol}</span>
                <span className="text-green-300">{r._score}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10">
          <div className="text-[10px] text-white/70 mb-1">Laagste scores</div>
          <ul className="space-y-1">
            {topDown.map((r) => (
              <li key={`down-${r.slug}`} className="flex items-center justify-between text-xs">
                <span className="font-semibold">{r.symbol}</span>
                <span className="text-red-300">{r._score}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  )
}

function Heatmap({ rows }: { rows: any[] }) {
  const [filter, setFilter] = useState<StatusFilter>('ALL')

  const filtered = useMemo(() => {
    if (!rows) return []
    if (filter === 'ALL') return rows
    return rows.filter((r) => (r.status || 'HOLD') === filter)
  }, [rows, filter])

  if (!rows || rows.length === 0) return null

  const Chip = ({ value, label }: { value: StatusFilter, label: string }) => {
    const active = filter === value
    return (
      <button
        onClick={() => setFilter(value)}
        className={[
          'px-2.5 py-1 rounded-full text-[11px] transition',
          'border',
          active
            ? 'bg-white/10 border-white/30 text-white'
            : 'bg-white/5 border-white/10 text-white/80 hover:bg-white/10 hover:border-white/20'
        ].join(' ')}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="table-card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold">Heatmap</h3>
        <div className="flex items-center gap-1.5">
          <Chip value="ALL" label="All" />
          <Chip value="BUY" label="Buy" />
          <Chip value="HOLD" label="Hold" />
          <Chip value="SELL" label="Sell" />
        </div>
      </div>

      {/* Legenda */}
      <div className="mb-2 flex items-center gap-3 text-[10px] text-white/70">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'hsl(142 65% 36%)' }} />
          BUY
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'hsl(38 70% 42%)' }} />
          HOLD
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'hsl(0 70% 36%)' }} />
          SELL
        </span>
      </div>

      {/* Tegels met echte score/status */}
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(46px, 1fr))' }}
      >
        {filtered.map((c: any) => {
          const score = Number(c._score ?? 0)
          const status = (c.status as Status) || 'HOLD'
          const { c1, c2 } = colorStops(status, score)
          return (
            <Link
              key={c.slug}
              href={`/crypto/${c.slug}`}
              title={`${c.name} (${c.symbol}) • ${status} · ${Math.round(score)}`}
              className={[
                'group rounded-[10px] ring-1 ring-white/10',
                'shadow-[0_6px_16px_rgba(0,0,0,0.30)] hover:shadow-[0_10px_22px_rgba(0,0,0,0.35)]',
                'transition-transform duration-150 hover:-translate-y-0.5'
              ].join(' ')}
              style={{
                background: `linear-gradient(135deg, ${c1}, ${c2})`,
                color: '#fff',
                aspectRatio: '1 / 1',
              }}
            >
              <div className="relative h-full w-full flex flex-col items-center justify-center">
                <div className="text-[10px] font-extrabold leading-none tracking-wide drop-shadow-sm">
                  {c.symbol}
                </div>
                <div className="mt-0.5 text-[9px] opacity-95 leading-none">
                  {Math.round(score)}
                </div>
                <div className="pointer-events-none absolute inset-0 rounded-[10px] ring-1 ring-white/10" />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ---------- page ----------
type SortKey = 'fav' | 'coin' | 'price' | 'd' | 'w' | 'm' | 'status'
type SortDir = 'asc' | 'desc'

function PageInner() {
  // build rows vanuit COINS + Binance symbolen (met fallback)
  const baseRows = useMemo(() => {
    return COINS.slice(0, 50).map((c, i) => {
      const fromList = (c as any)?.pairUSD?.binance as string | null | undefined
      const fallback = toBinancePair(c.symbol)
      return {
        slug: (c.slug || c.symbol.toLowerCase()),
        symbol: c.symbol,
        name: c.name,
        binance: fromList || fallback, // <-- belangrijk voor Vercel
        _rank: i,
        _price: null as number | null,
        _d: 0 as number | null,
        _w: 0 as number | null,
        _m: 0 as number | null,
        _score: 0,
        status: 'HOLD' as Status,
        _fav: false,
      }
    })
  }, [])

  // Favorieten
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

  // NEW: lokale TA state (detailpagina schrijft hierin via localStorage)
  const [localTA, setLocalTA] = useState<Map<string, LocalTA>>(new Map())
  useEffect(() => {
    setLocalTA(readAllLocalTA())
    function onStorage(ev: StorageEvent) {
      if (!ev.key || !ev.key.startsWith(TA_KEY_PREFIX)) return
      setLocalTA(readAllLocalTA())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // ---- Indicators ophalen (Light) ----
  const symbolsCsv = useMemo(
    () => baseRows.map(r => r.binance).filter(Boolean).join(','),
    [baseRows]
  )
  const { data: indData } = useSWR<{ results: IndResp[] }>(
    symbolsCsv ? `/api/crypto-light/indicators?symbols=${encodeURIComponent(symbolsCsv)}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 120_000 }
  )
  const indBySym = useMemo(() => {
    const map = new Map<string, IndResp>()
    for (const it of (indData?.results || [])) map.set(it.symbol, it)
    return map
  }, [indData])

  // ---- Prijs + d/w/m ophalen (Light) ----
  const { data: pxData } = useSWR<{ results: { symbol: string, price: number|null, d: number|null, w: number|null, m: number|null }[] }>(
    symbolsCsv ? `/api/crypto-light/prices?symbols=${encodeURIComponent(symbolsCsv)}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 15_000 }
  )
  const pxBySym = useMemo(() => {
    const map = new Map<string, { price: number|null, d: number|null, w: number|null, m: number|null }>()
    for (const it of (pxData?.results || [])) map.set(it.symbol, { price: it.price, d: it.d, w: it.w, m: it.m })
    return map
  }, [pxData])

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('coin')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(nextKey); if (nextKey === 'coin') setSortDir('asc'); else if (nextKey === 'fav') setSortDir('desc'); else setSortDir('desc') }
  }

  // rows verrijken met indicator-score + prijs/perf
  const rows = useMemo(() => {
    const list = baseRows.map((c) => {
      const symU = String(c.symbol || '').toUpperCase()
      const ind  = c.binance ? indBySym.get(c.binance) : undefined

      // 1) Probeer serverwaarden (status/score)
      const serverScore = (ind?.score != null && Number.isFinite(Number(ind.score))) ? Number(ind.score) : null
      const serverStatus = ind?.status as Status | undefined

      // 2) Fallback naar bestaande clientberekening
      const calc = scoreFromIndicators(ind)

      let finalScore = serverScore ?? calc.score
      let finalStatus = serverStatus ?? calc.status

      // 3) NEW: override met localStorage (door detailpagina berekend)
      const localKey = c.binance // bijv. "VETUSDT"
      if (localKey) {
        const ta = localTA.get(localKey)
        if (ta) {
          const fresh = (Date.now() - ta.ts) <= 10 * 60 * 1000 // 10 min
          if (fresh || serverScore == null) {
            finalScore = Number.isFinite(ta.score) ? ta.score : finalScore
            finalStatus = (ta.status as Status) || finalStatus
          }
        }
      }

      const px = c.binance ? pxBySym.get(c.binance) : undefined
      return {
        ...c,
        _fav: faves.includes(symU),
        _score: finalScore,
        status: finalStatus,
        _price: px?.price ?? null,
        _d: px?.d ?? null,
        _w: px?.w ?? null,
        _m: px?.m ?? null,
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
  }, [baseRows, faves, sortKey, sortDir, indBySym, pxBySym, localTA])

  const updatedAt = (indData || pxData) ? Date.now() : undefined

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="hero">Crypto Tracker (light)</h1>
          <p className="sub">Laatste update: {updatedAt ? new Date(updatedAt).toLocaleTimeString() : '—'}</p>
        </div>
        <nav className="flex items-center gap-4">
          <Link href="/indicators" className="text-sky-400 hover:text-sky-300 text-sm font-medium">Uitleg indicatoren</Link>
          <Link href="/disclaimer" className="text-sky-400 hover:text-sky-300 text-sm font-medium">Disclaimer</Link>
        </nav>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* LINKS: TABEL */}
        <div className="lg:col-span-8">
          <div className="table-card overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-white/60">
                <tr>
                  <th className="text-left py-2">#</th>
                  <th className="py-2 w-10 text-center">
                    <button
                      onClick={() => toggleSort('fav')}
                      title="Sorteren op favoriet"
                      className="mx-auto flex h-6 w-6 items-center justify-center rounded hover:bg-white/10 text-white/70 hover:text-white transition"
                    >
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
                    <button onClick={() => toggleSort('w')} className="inline-flex items-center gap-1 hover:text-white transition w-full justify-end">7d</button>
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
                  const status = (c.status as Status) || 'HOLD'
                  const badgeCls =
                    status === 'BUY'  ? 'badge-buy'  :
                    status === 'SELL' ? 'badge-sell' : 'badge-hold'

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
                      <td className="py-3 text-right">{formatFiat(c._price)}</td>
                      <td className={`py-3 text-right ${Number(c._d ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmtPct(c._d)}</td>
                      <td className={`py-3 text-right ${Number(c._w ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmtPct(c._w)}</td>
                      <td className={`py-3 text-right ${Number(c._m ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmtPct(c._m)}</td>

                      {/* Status-badge met score */}
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          className={`${badgeCls} text-xs px-2 py-1 rounded`}
                          title={`Status: ${status} · Score: ${scoreNum}`}
                          aria-label={`Status ${status} met score ${scoreNum}`}
                        >
                          {status} · {scoreNum}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* RECHTS: AI-ADVIES + SAMENVATTING + HEATMAP */}
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

// Client-only om hydration mismatch te voorkomen
export default dynamic(() => Promise.resolve(PageInner), { ssr: false })