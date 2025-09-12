// src/pages/index.tsx
import { useEffect, useMemo, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import Link from 'next/link'
import ScoreBadge from '@/components/ScoreBadge'

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json().catch(() => null)
    if (!r.ok) {
      const msg = (data && (data.error || data.message)) || `HTTP ${r.status}`
      const err = new Error(msg) as Error & { status?: number }
      err.status = r.status
      throw err
    }
    return data
  })

// Netjes prijzen weergeven (— bij onbekend)
function formatFiat(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (v >= 1000) return v.toLocaleString('nl-NL', { maximumFractionDigits: 0 })
  if (v >= 1)    return v.toLocaleString('nl-NL', { maximumFractionDigits: 2 })
  return v.toLocaleString('nl-NL', { maximumFractionDigits: 6 })
}

// ───── Heatmap helpers ─────
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}
function colorStops(status: 'BUY'|'HOLD'|'SELL', score: number) {
  const s = clamp(score, 0, 100)
  let hue = 38, sat = 70, light = 42 // HOLD amber
  if (status === 'BUY') {
    hue = 142; sat = 65
    const t = clamp((s - 66) / 34, 0, 1)
    light = 44 - 12 * t
  } else if (status === 'SELL') {
    hue = 0; sat = 70
    const t = clamp((33 - s) / 33, 0, 1)
    light = 44 - 12 * t
  }
  const c1 = `hsl(${hue} ${sat}% ${light}%)`
  const c2 = `hsl(${hue} ${sat}% ${clamp(light + 8, 20, 62)}%)`
  return { c1, c2 }
}

type StatusFilter = 'ALL' | 'BUY' | 'HOLD' | 'SELL'

// ───────────────────────────────────────────────
// AI-marktsamenvatting (rechtsboven, boven Dagelijkse samenvatting)
// ───────────────────────────────────────────────
function AISummary({ rows, updatedAt }: { rows: any[], updatedAt?: number }) {
  if (!rows || rows.length === 0) return null

  const total = rows.length
  const buy = rows.filter((r) => (r.status || 'HOLD') === 'BUY').length
  const sell = rows.filter((r) => (r.status || 'HOLD') === 'SELL').length

  const buyPct = Math.round((buy / total) * 100)
  const sellPct = Math.round((sell / total) * 100)
  const greenPct = Math.round(
    (rows.filter((r) => Number(r._d ?? 0) >= 0).length / total) * 100
  )
  const avgScore = Math.round(
    rows.reduce((s, r) => s + Number(r._score ?? 0), 0) / Math.max(1, total)
  )
  const avgD = rows.reduce((s, r) => s + Number(r._d ?? 0), 0) / Math.max(1, total)

  let bias: 'Bullish' | 'Bearish' | 'Neutraal' = 'Neutraal'
  if ((buyPct - sellPct) >= 10 || avgScore >= 58 || avgD >= 0.5) bias = 'Bullish'
  if ((sellPct - buyPct) >= 10 || avgScore <= 42 || avgD <= -0.5) bias = 'Bearish'

  const biasCls =
    bias === 'Bullish' ? 'badge-buy'
      : bias === 'Bearish' ? 'badge-sell'
      : 'badge-hold'

  return (
    <aside className="table-card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold">AI-advies (markt)</h3>
        {updatedAt ? (
          <div className="text-xs text-white/60">Stand: {new Date(updatedAt).toLocaleTimeString()}</div>
        ) : null}
      </div>

      <div className="text-sm mb-3">
        <span className={`${biasCls} mr-2`}>{bias}</span>
        <span className="text-white/80">
          BUY {buyPct}% · SELL {sellPct}% · 24h groen {greenPct}%
        </span>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-white/70">
        <span className="px-2 py-1 rounded bg-white/5 ring-1 ring-white/10">Gem. score <b className="text-white/90">{avgScore}</b></span>
        <span className="px-2 py-1 rounded bg-white/5 ring-1 ring-white/10">Gem. 24h <b className={`text-white/90 ${avgD >= 0 ? 'text-green-300' : 'text-red-300'}`}>{avgD >= 0 ? '+' : ''}{avgD.toFixed(2)}%</b></span>
      </div>
    </aside>
  )
}

// ───────────────────────────────────────────────
// Dagelijkse samenvatting
// ───────────────────────────────────────────────
function DailySummary({ rows, updatedAt }: { rows: any[], updatedAt?: number }) {
  if (!rows || rows.length === 0) return null

  const total = rows.length
  const buy = rows.filter((r) => (r.status || 'HOLD') === 'BUY').length
  const hold = rows.filter((r) => (r.status || 'HOLD') === 'HOLD').length
  const sell = rows.filter((r) => (r.status || 'HOLD') === 'SELL').length
  const pct = (n: number) => Math.round((n / Math.max(1, total)) * 100)

  const avgScore = Math.round(
    rows.reduce((s, r) => s + Number(r._score ?? 0), 0) / Math.max(1, total)
  )
  const greenPct = pct(rows.filter((r) => Number(r._d ?? 0) >= 0).length)

  const by24h = [...rows].sort((a, b) => Number(b._d ?? 0) - Number(a._d ?? 0))
  const topUp = by24h.slice(0, Math.min(3, by24h.length))
  const topDown = by24h.reverse().slice(0, Math.min(3, by24h.length))
  const fmt = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`

  return (
    <aside className="table-card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold">Dagelijkse samenvatting</h3>
        {updatedAt ? (
          <div className="text-xs text-white/60">Stand: {new Date(updatedAt).toLocaleTimeString()}</div>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10">
          <div className="text-[10px] text-white/70 mb-1">BUY</div>
          <div className="flex items-end justify-between">
            <div className="text-lg font-bold text-green-300">{pct(buy)}%</div>
            <div className="text-xs text-white/60">{buy}/{total}</div>
          </div>
        </div>
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10">
          <div className="text-[10px] text-white/70 mb-1">HOLD</div>
          <div className="flex items-end justify-between">
            <div className="text-lg font-bold text-amber-300">{pct(hold)}%</div>
            <div className="text-xs text-white/60">{hold}/{total}</div>
          </div>
        </div>
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10">
          <div className="text-[10px] text-white/70 mb-1">SELL</div>
            <div className="flex items-end justify-between">
            <div className="text-lg font-bold text-red-300">{pct(sell)}%</div>
            <div className="text-xs text-white/60">{sell}/{total}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10">
          <div className="text-[10px] text-white/70 mb-1">Breadth (24h groen)</div>
          <div className="text-lg font-bold">{greenPct}%</div>
        </div>
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10">
          <div className="text-[10px] text-white/70 mb-1">Gem. score</div>
          <div className="text-lg font-bold">{avgScore}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10">
          <div className="text-[10px] text-white/70 mb-1">Top stijgers (24h)</div>
          <ul className="space-y-1">
            {topUp.map((r) => (
              <li key={`up-${r.slug}`} className="flex items-center justify-between text-xs">
                <span className="font-semibold">{r.symbol}</span>
                <span className="text-green-300">{fmt(Number(r._d ?? 0))}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white/[0.04] rounded-lg p-2 ring-1 ring-white/10">
          <div className="text-[10px] text-white/70 mb-1">Top dalers (24h)</div>
          <ul className="space-y-1">
            {topDown.map((r) => (
              <li key={`down-${r.slug}`} className="flex items-center justify-between text-xs">
                <span className="font-semibold">{r.symbol}</span>
                <span className="text-red-300">{fmt(Number(r._d ?? 0))}</span>
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

      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(46px, 1fr))' }}
      >
        {filtered.map((c: any) => {
          const score = Number(c.score ?? 0)
          const status = (c.status as 'BUY'|'HOLD'|'SELL') || 'HOLD'
          const { c1, c2 } = colorStops(status, score)
          return (
            <Link
              key={c.slug}
              href={`/coin/${c.slug}`}
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

type SortKey = 'fav' | 'coin' | 'price' | 'd' | 'w' | 'm' | 'status'
type SortDir = 'asc' | 'desc'

function SkeletonTable() {
  return (
    <div className="table-card mb-6">
      <div className="animate-pulse">
        <div className="h-4 w-40 bg-white/10 rounded mb-4" />
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-8 bg-white/5 rounded mb-2" />
        ))}
      </div>
    </div>
  )
}

export default function Home() {
  const { mutate } = useSWRConfig()
  const { data, error, isLoading } = useSWR('/api/v1/coins', fetcher, {
    refreshInterval: 0,          // 🔹 geen polling nodig voor de lijst
    revalidateOnFocus: false,    // 🔹 niet opnieuw laden bij focus
  })
  const results: any[] = Array.isArray(data?.results) ? data!.results : []

  const [faves, setFaves] = useState<string[]>([])
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('faves') : null
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) setFaves(arr.map((s) => String(s).toUpperCase()))
      }
    } catch { /* ignore */ }
  }, [])
  function toggleFav(sym: string) {
    const s = String(sym || '').toUpperCase()
    setFaves(prev => {
      const next = prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
      try { localStorage.setItem('faves', JSON.stringify(next)) } catch {}
      return next
    })
  }

  // Prijzen ophalen (mogen licht poll’en)
  const symbolsCsv = results.map((c: any) => String(c.symbol || '').toUpperCase()).join(',')
  const { data: pricesData } = useSWR(
    symbolsCsv ? `/api/v1/prices?symbols=${encodeURIComponent(symbolsCsv)}` : null,
    fetcher,
    { refreshInterval: 15_000, revalidateOnFocus: false }
  )

  const [sortKey, setSortKey] = useState<SortKey>('coin')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(nextKey)
      if (nextKey === 'coin') setSortDir('asc')
      else if (nextKey === 'fav') setSortDir('desc')
      else setSortDir('desc')
    }
  }

  const rows = useMemo(() => {
    const list = results.map((c, i) => {
      const sym = String(c.symbol || '').toUpperCase()
      const p = (pricesData as any)?.prices?.[sym]
      const price = typeof p === 'number' ? p : (typeof p?.usd === 'number' ? p.usd : null)
      return {
        ...c,
        _rank: i,
        _price: price as number | null,
        _d: Number(c?.perf?.d ?? 0),
        _w: Number(c?.perf?.w ?? 0),
        _m: Number(c?.perf?.m ?? 0),
        _score: Number(c?.score ?? 0),
        _fav: faves.includes(sym),
      }
    })

    const dir = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'fav':
          return ((a._fav === b._fav) ? 0 : a._fav ? 1 : -1) * dir
        case 'coin':
          return (a._rank - b._rank) * dir
        case 'price':
          if (a._price == null && b._price == null) return 0
          if (a._price == null) return 1
          if (b._price == null) return -1
          return (a._price - b._price) * dir
        case 'd':
          return (a._d - b._d) * dir
        case 'w':
          return (a._w - b._w) * dir
        case 'm':
          return (a._m - b._m) * dir
        case 'status':
          return (a._score - b._score) * dir
        default:
          return 0
      }
    })
  }, [results, pricesData, sortKey, sortDir, faves])

  function StarHeader() {
    const active = sortKey === 'fav'
    const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : ' '
    return (
      <button
        onClick={() => toggleSort('fav')}
        title="Sorteren op favoriet"
        className="mx-auto flex h-6 w-6 items-center justify-center rounded hover:bg-white/10 text-white/70 hover:text-white transition"
      >
        <span className="leading-none">⭐</span>
        <span className="sr-only">Favoriet</span>
        <span className="pointer-events-none absolute translate-x-4 text:[10px] text-white/60">{arrow}</span>
      </button>
    )
  }

  function header(label: string, key: SortKey, align: 'left'|'right' = 'left') {
    const active = sortKey === key
    const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : ' '
    return (
      <button
        onClick={() => toggleSort(key)}
        className={`inline-flex items-center gap-1 hover:text-white transition ${align === 'right' ? 'justify-end w-full' : ''}`}
        title="Sorteren"
      >
        <span>{label}</span>
        <span className={`text-xs ${active ? 'text-white/80' : 'text-white/40'}`}>{arrow}</span>
      </button>
    )
  }

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="hero">Crypto Tracker</h1>
          {data?.updatedAt && (
            <p className="sub">Laatste update: {new Date(data.updatedAt).toLocaleTimeString()}</p>
          )}
        </div>
        <nav className="flex items-center gap-4">
          <Link href="/indicators" className="text-sky-400 hover:text-sky-300 text-sm font-medium">
            Uitleg indicatoren
          </Link>
          <Link href="/disclaimer" className="text-sky-400 hover:text-sky-300 text-sm font-medium">
            Disclaimer
          </Link>
        </nav>
      </header>

      {error && (
        <div className="table-card mb-6">
          <div className="text-red-300 font-semibold mb-2">Kon data niet laden</div>
          <div className="text-white/70 text-sm mb-3">
            {error.message || 'Onbekende fout'}
            {(error as any).status ? ` (HTTP ${(error as any).status})` : ''}
          </div>
          <button className="btn" onClick={() => mutate('/api/v1/coins')}>Opnieuw proberen</button>
        </div>
      )}

      {!error && (isLoading || results.length === 0) && <SkeletonTable />}

      {rows.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <div className="table-card overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-white/60">
                  <tr>
                    <th className="text-left py-2">#</th>
                    <th className="py-2 w-10 text-center">
                      <StarHeader />
                    </th>
                    <th className="text-left py-2">
                      {header('Coin', 'coin', 'left')}
                    </th>
                    <th className="text-right py-2">
                      {header('Prijs', 'price', 'right')}
                    </th>
                    <th className="text-right py-2">
                      {header('24h', 'd', 'right')}
                    </th>
                    <th className="text-right py-2">
                      {header('7d', 'w', 'right')}
                    </th>
                    <th className="text-right py-2">
                      {header('30d', 'm', 'right')}
                    </th>
                    <th className="text-right py-2">
                      {header('Status', 'status', 'right')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c: any, i: number) => {
                    const sym = String(c.symbol || '').toUpperCase()
                    const p = (pricesData as any)?.prices?.[sym]
                    const price = typeof p === 'number' ? p : (typeof p?.usd === 'number' ? p.usd : null)
                    const isFav = c._fav === true
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
                          <Link href={`/coin/${c.slug}`} className="link font-semibold">
                            {c.name} <span className="ticker">({c.symbol})</span>
                          </Link>
                        </td>
                        <td className="py-3 text-right">{formatFiat(price)}</td>
                        <td className="py-3 text-right">{Number(c?.perf?.d ?? 0).toFixed(2)}%</td>
                        <td className="py-3 text-right">{Number(c?.perf?.w ?? 0).toFixed(2)}%</td>
                        <td className="py-3 text-right">{Number(c?.perf?.m ?? 0).toFixed(2)}%</td>
                        <td className="py-3 text-right">
                          <ScoreBadge score={Number(c?.score ?? 0)} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-4">
            <div className="sticky top-6 space-y-6">
              <AISummary rows={rows} updatedAt={data?.updatedAt} />
              <DailySummary rows={rows} updatedAt={data?.updatedAt} />
              <Heatmap rows={rows} />
            </div>
          </div>
        </div>
      )}
    </main>
  )
}