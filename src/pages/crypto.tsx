import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import useSWR from 'swr'
import { COINS } from '@/lib/coins'
import { computeScoreStatus } from '@/lib/taScore'
import ScoreBadge from '@/components/ScoreBadge'

// ---------- helpers ----------
const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(r => r.json())

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

// Yahoo “BTC-USD” → Binance “BTCUSDT” (stablecoins overslaan)
const toBinancePair = (symbol: string) => {
  const s = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const skip = new Set(['USDT','USDC','BUSD','DAI','TUSD'])
  if (!s || skip.has(s)) return null
  return `${s}USDT`
}

// ---------- API shapes ----------
type IndResp = {
  symbol: string
  ma?: { ma50: number|null; ma200: number|null; cross?: string }
  rsi?: number|null
  macd?: { macd: number|null; signal: number|null; hist: number|null }
  volume?: { volume: number|null; avg20d: number|null; ratio: number|null }
  // backend mag ook direct score/status meeleveren – maar wij herberekenen client-side met computeScoreStatus
  score?: number
  status?: Status
  error?: string
}
type PxResp = { results: { symbol: string; price: number|null; d: number|null; w: number|null; m: number|null }[] }

// ---------- rechterkolom widgets ----------
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
  // basis-rows uit COINS
  const baseRows = useMemo(() => {
    return COINS.slice(0, 50).map((c, i) => {
      const fromList = (c as any)?.pairUSD?.binance as string | null | undefined
      const fallback = toBinancePair(c.symbol.replace('-USD',''))
      return {
        slug: (c.slug || c.symbol.toLowerCase()),
        symbol: c.symbol,
        name: c.name,
        binance: fromList || fallback,
        _rank: i,
        _price: null as number | null,
        _d: 0 as number | null,
        _w: 0 as number | null,
        _m: 0 as number | null,
        _score: 50,
        status: 'HOLD' as Status,
        _fav: false,
      }
    })
  }, [])

  // favorieten
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

  // indicators ophalen (batched) en prijzen ophalen (SWR)
  const symbols = useMemo(() => baseRows.map(r => r.binance).filter(Boolean) as string[], [baseRows])
  const [indBySym, setIndBySym] = useState<Map<string, IndResp>>(new Map())
  const [indUpdatedAt, setIndUpdatedAt] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (!symbols.length) return
    let aborted = false

    async function fetchGroup(group: string[]) {
      const url = `/api/crypto-light/indicators?symbols=${encodeURIComponent(group.join(','))}`
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json() as { results?: IndResp[] }
      const arr = Array.isArray(j.results) ? j.results : []
      if (aborted) return
      setIndBySym(prev => {
        const next = new Map(prev)
        for (const it of arr) next.set(it.symbol, it)
        return next
      })
      setIndUpdatedAt(Date.now())
    }

    async function run() {
      // chunks van 12 om burst te beperken
      for (let i = 0; i < symbols.length; i += 12) {
        const group = symbols.slice(i, i + 12)
        try { await fetchGroup(group) } catch {}
        await new Promise(r => setTimeout(r, 120)) // mini-pause
      }
    }

    run()
    const id = setInterval(run, 120_000)
    return () => { aborted = true; clearInterval(id) }
  }, [symbols])

  // prijzen + d/w/m
  const symbolsCsv = useMemo(() => symbols.join(','), [symbols])
  const { data: pxData } = useSWR<PxResp>(
    symbolsCsv ? `/api/crypto-light/prices?symbols=${encodeURIComponent(symbolsCsv)}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 15_000 }
  )
  const pxBySym = useMemo(() => {
    const map = new Map<string, { price: number|null, d: number|null, w: number|null, m: number|null }>()
    for (const it of (pxData?.results || [])) map.set(it.symbol, { price: it.price, d: it.d, w: it.w, m: it.m })
    return map
  }, [pxData])

  // sortering
  const [sortKey, setSortKey] = useState<SortKey>('coin')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(nextKey); if (nextKey === 'coin') setSortDir('asc'); else if (nextKey === 'fav') setSortDir('desc'); else setSortDir('desc') }
  }

  // rows verrijken met score/status (via computeScoreStatus) + prijs/perf
  const rows = useMemo(() => {
    const list = baseRows.map((c) => {
      const ind = c.binance ? indBySym.get(c.binance) : undefined
      let score = 50
      let status: Status = 'HOLD'
      if (ind) {
        const res = computeScoreStatus({
          ma: ind.ma, rsi: ind.rsi, macd: ind.macd, volume: ind.volume
        } as any)
        score = res.score
        status = (res.status as Status) || statusFromScore(res.score)
      }
      const px = c.binance ? pxBySym.get(c.binance) : undefined
      return {
        ...c,
        _fav: faves.includes(String(c.symbol).toUpperCase()),
        _score: score,
        status,
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
  }, [baseRows, faves, sortKey, sortDir, indBySym, pxBySym])

  const updatedAt = (indUpdatedAt || pxData) ? (indUpdatedAt ?? Date.now()) : undefined

  return (
    <main className="w-full overflow-x-hidden">
      <div className="max-w-6xl mx-auto p-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="hero">Crypto Tracker (light)</h1>
            <p className="sub">Laatste update: {updatedAt ? new Date(updatedAt).toLocaleTimeString() : '—'}</p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-12 min-w-0">
          {/* LINKS: TABEL */}
          <div className="lg:col-span-8 min-w-0">
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
                    <th className="text-right py-2">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c: any, i: number) => {
                    const sym = String(c.symbol || '').toUpperCase()
                    const isFav = c._fav === true
                    const scoreNum = Number.isFinite(Number(c._score)) ? Math.round(Number(c._score)) : 50
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
                        <td className="py-3 text-right">
                          <div className="inline-block align-middle">
                            <ScoreBadge score={scoreNum} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* RECHTS: AI-ADVIES + SAMENVATTING + HEATMAP */}
          <div className="lg:col-span-4 min-w-0">
            <div className="sticky top-6 space-y-6">
              <AISummary rows={rows} updatedAt={updatedAt} />
              <DailySummary rows={rows} updatedAt={updatedAt} />
              <Heatmap rows={rows} />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

// Client-only om hydration mismatch te voorkomen
export default dynamic(() => Promise.resolve(PageInner), { ssr: false })