// src/pages/equity-favorites/index.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import useSWR from 'swr'
import ScoreBadge from '@/components/ScoreBadge'

type Advice = 'BUY' | 'HOLD' | 'SELL'

type Favorite = {
  id?: string
  kind: 'EQUITY'
  symbol: string
  market: string
  createdAt?: string
}

type SnapItem = {
  symbol: string
  price?: number | null
  change?: number | null
  changePct?: number | null
  ma?: { ma50: number | null; ma200: number | null; status?: Advice }
  rsi?: number | null
  macd?: { macd: number | null; signal: number | null; hist: number | null }
  volume?: { volume: number | null; avg20d: number | null; ratio: number | null }
  score?: number
}

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(r => r.json())

function num(v: number | null | undefined, d = 2) {
  return (v ?? v === 0) && Number.isFinite(v as number) ? (v as number).toFixed(d) : '—'
}
const pctCls = (p?: number | null) =>
  Number(p) > 0 ? 'text-green-600' : Number(p) < 0 ? 'text-red-600' : 'text-gray-500'

const statusFromScore = (score?: number): Advice => {
  const s = Number(score)
  if (!Number.isFinite(s)) return 'HOLD'
  return s >= 66 ? 'BUY' : s <= 33 ? 'SELL' : 'HOLD'
}

// batching helpers (zelfde beleid als je index pages)
const CHUNK = 50
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
async function pool<T, R>(arr: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length) as any
  let i = 0
  const workers = new Array(Math.min(n, arr.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++
      if (idx >= arr.length) break
      out[idx] = await fn(arr[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

// routes + currency + display symbol per market
const MARKET_META: Record<
  string,
  { route: string; currency: string; disp?: (s: string) => string }
> = {
  AEX: { route: 'aex', currency: 'EUR', disp: s => s.replace(/\.AS$/i, '') },
  SP500: { route: 'sp500', currency: 'USD' },
  NASDAQ: { route: 'nasdaq', currency: 'USD' },
  DOWJONES: { route: 'dowjones', currency: 'USD' },
  DAX: { route: 'dax', currency: 'EUR' },
  FTSE100: { route: 'ftse100', currency: 'GBP', disp: s => s.replace(/\.L$/i, '') },
  NIKKEI225: { route: 'nikkei225', currency: 'JPY', disp: s => s.replace(/\.T$/i, '') },
  HANGSENG: { route: 'hangseng', currency: 'HKD', disp: s => s.replace(/\.HK$/i, '') },
  SENSEX: {
    route: 'sensex',
    currency: 'INR',
    disp: s => s.replace(/\.BO$/i, '').replace(/\.NS$/i, ''),
  },
  ETFS: { route: 'etfs', currency: 'USD' },
}

function fmtPrice(v: number | null | undefined, ccy: string) {
  if (v == null || !Number.isFinite(v)) return '—'
  try {
    return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: ccy }).format(v as number)
  } catch {}
  return (v as number).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function EquityFavorites() {
  const { status: authStatus } = useSession()
  const canFav = authStatus === 'authenticated'

  const { data: favData, mutate: mutateFavs } = useSWR<any>(
    canFav ? '/api/user/favorites?kind=EQUITY' : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const favorites: Favorite[] = useMemo(() => {
    const arr = Array.isArray(favData?.favorites) ? favData.favorites : []
    return arr.filter((x: any) => String(x?.kind || '') === 'EQUITY')
  }, [favData])

  const markets = useMemo(() => {
    const set = new Set<string>()
    favorites.forEach(f => set.add(String(f.market || '').toUpperCase()))
    return Array.from(set).sort()
  }, [favorites])

  const [marketFilter, setMarketFilter] = useState<string>('ALL')
  useEffect(() => {
    // keep filter valid if favorites change
    if (marketFilter !== 'ALL' && !markets.includes(marketFilter)) setMarketFilter('ALL')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets.join('|')])

  const filteredFavs = useMemo(() => {
    if (marketFilter === 'ALL') return favorites
    return favorites.filter(f => String(f.market || '').toUpperCase() === marketFilter)
  }, [favorites, marketFilter])

  const symbols = useMemo(() => filteredFavs.map(f => f.symbol), [filteredFavs])

  // ⭐ set for quick lookup
  const favSet = useMemo(() => {
    const set = new Set<string>()
    favorites.forEach(f => set.add(`${String(f.market || '').toUpperCase()}::${String(f.symbol || '').toUpperCase()}`))
    return set
  }, [favorites])

  async function toggleFav(market: string, symbol: string) {
    if (!canFav) return
    const m = String(market || '').toUpperCase()
    const s = String(symbol || '').toUpperCase()
    const key = `${m}::${s}`
    const isFav = favSet.has(key)

    const current = Array.isArray(favData?.favorites) ? favData.favorites : []
    const optimistic = isFav
      ? current.filter(
          (it: any) =>
            !(
              String(it?.kind || '') === 'EQUITY' &&
              String(it?.market || '').toUpperCase() === m &&
              String(it?.symbol || '').toUpperCase() === s
            )
        )
      : [
          { id: `tmp:EQUITY:${m}:${s}`, kind: 'EQUITY', market: m, symbol: s, createdAt: new Date().toISOString() },
          ...current,
        ]

    await mutateFavs({ favorites: optimistic }, { revalidate: false })

    try {
      if (!isFav) {
        const r = await fetch('/api/user/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'EQUITY', market: m, symbol: s }),
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
      } else {
        const r = await fetch(
          `/api/user/favorites?kind=EQUITY&symbol=${encodeURIComponent(s)}&market=${encodeURIComponent(m)}`,
          { method: 'DELETE' }
        )
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
      }
      await mutateFavs()
    } catch {
      await mutateFavs()
    }
  }

  // snapshot + returns
  const [items, setItems] = useState<SnapItem[]>([])
  const [snapErr, setSnapErr] = useState<string | null>(null)
  const [ret7Map, setRet7Map] = useState<Record<string, number>>({})
  const [ret30Map, setRet30Map] = useState<Record<string, number>>({})

  useEffect(() => {
    let timer: any,
      aborted = false

    async function load() {
      try {
        setSnapErr(null)
        if (!symbols.length) {
          if (!aborted) setItems([])
          return
        }
        const groups = chunk(symbols, CHUNK)
        const parts = await pool(groups, 4, async (group, gi) => {
          if (gi) await sleep(80)
          const url = `/api/indicators/snapshot?symbols=${encodeURIComponent(group.join(','))}`
          const r = await fetch(url, { cache: 'no-store' })
          if (!r.ok) throw new Error(`HTTP ${r.status} @ snapshot[${gi}]`)
          const j: { items: SnapItem[] } = await r.json()
          return j.items || []
        })
        if (!aborted) setItems(parts.flat())
      } catch (e: any) {
        if (!aborted) setSnapErr(String(e?.message || e))
      } finally {
        if (!aborted) timer = setTimeout(load, 30000)
      }
    }

    load()
    return () => {
      aborted = true
      if (timer) clearTimeout(timer)
    }
  }, [symbols.join(',')])

  useEffect(() => {
    let aborted = false
    async function loadDays(days: 7 | 30) {
      if (!symbols.length) return {}
      const groups = chunk(symbols, CHUNK)
      const parts = await pool(groups, 4, async (group, gi) => {
        if (gi) await sleep(80)
        const url = `/api/indicators/ret-batch?days=${days}&symbols=${encodeURIComponent(group.join(','))}`
        const r = await fetch(url, { cache: 'no-store' })
        if (!r.ok) return { items: [] as any[] }
        return r.json() as Promise<{ items: { symbol: string; days: number; pct: number | null }[] }>
      })
      const map: Record<string, number> = {}
      parts.forEach(p =>
        p.items?.forEach(it => {
          if (Number.isFinite(it.pct as number)) map[it.symbol] = it.pct as number
        })
      )
      return map
    }

    ;(async () => {
      const [m7, m30] = await Promise.all([loadDays(7), loadDays(30)])
      if (!aborted) {
        setRet7Map(m7 as any)
        setRet30Map(m30 as any)
      }
    })()

    return () => {
      aborted = true
    }
  }, [symbols.join(',')])

  const bySym = useMemo(() => {
    const m: Record<string, SnapItem> = {}
    items.forEach(it => {
      if (it?.symbol) m[it.symbol] = it
    })
    return m
  }, [items])

  // Hydration-safe clock
  const [timeStr, setTimeStr] = useState('')
  useEffect(() => {
    const upd = () => setTimeStr(new Date().toLocaleTimeString('nl-NL', { hour12: false }))
    upd()
    const id = setInterval(upd, 1000)
    return () => clearInterval(id)
  }, [])

  const rows = useMemo(() => {
    return filteredFavs
      .map(f => {
        const market = String(f.market || '').toUpperCase()
        const symbol = String(f.symbol || '').toUpperCase()
        const meta = MARKET_META[market]
        const href = meta ? `/${meta.route}/${encodeURIComponent(symbol)}` : `#`

        const it = bySym[symbol]
        const score = Number(it?.score)
        const status = statusFromScore(score)

        return {
          market,
          symbol,
          disp: meta?.disp ? meta.disp(symbol) : symbol,
          currency: meta?.currency || 'USD',
          href,
          it,
          score,
          status,
          r7: ret7Map[symbol],
          r30: ret30Map[symbol],
        }
      })
      .sort((a, b) => (a.market === b.market ? a.symbol.localeCompare(b.symbol) : a.market.localeCompare(b.market)))
  }, [filteredFavs, bySym, ret7Map, ret30Map])

  return (
    <>
      <Head>
        <title>Equity Favorites — SignalHub</title>
      </Head>

      <main className="min-h-screen">
        <section className="max-w-6xl mx-auto px-4 pt-16 pb-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="hero">Equity Favorites</h1>
              <div className="mt-2 text-sm text-gray-500 dark:text-slate-400">
                Your starred equities across all markets.
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <div className="text-xs text-gray-500 dark:text-slate-400">
                Stand: <span suppressHydrationWarning>{timeStr}</span>
              </div>

              <select
                className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
                value={marketFilter}
                onChange={e => setMarketFilter(e.target.value)}
                disabled={!canFav}
                title={!canFav ? 'Log in to view your favorites' : 'Filter by market'}
              >
                <option value="ALL">All markets</option>
                {markets.map(m => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-16">
          {!canFav && (
            <div className="table-card p-4 text-sm text-gray-700 dark:text-slate-200">
              Please log in to view your equity favorites.
            </div>
          )}

          {canFav && favorites.length === 0 && (
            <div className="table-card p-4 text-sm text-gray-700 dark:text-slate-200">
              No favorites yet. Star equities on any market page to see them here.
            </div>
          )}

          {canFav && !!favorites.length && (
            <>
              {snapErr && <div className="mb-3 text-red-600 text-sm">Fout bij laden: {snapErr}</div>}

              {/* ONLY TABLE (no right column) */}
              <div className="table-card p-0 overflow-hidden">
                <table className="w-full text-[13px] table-fixed">
                  <colgroup>
                    <col className="w-10" />
                    <col className="w-10" />
                    <col className="w-[12%]" />
                    <col className="w-[28%]" />
                    <col className="w-[12%]" />
                    <col className="w-[14%]" />
                    <col className="w-[10%]" />
                    <col className="w-[10%]" />
                    <col className="w-[14%]" />
                  </colgroup>

                  <thead className="bg-gray-50 dark:bg-slate-900/60">
                    <tr className="text-left text-gray-500 dark:text-slate-400">
                      <th className="px-3 py-3">#</th>
                      <th className="px-2 py-3 text-center" title="Favorites">
                        <span className="sr-only">Favorite</span>★
                      </th>
                      <th className="px-2 py-3">Market</th>
                      <th className="px-2 py-3">Equity</th>
                      <th className="px-3 py-3">Price</th>
                      <th className="px-3 py-3">24h</th>
                      <th className="px-3 py-3">7d</th>
                      <th className="px-3 py-3">30d</th>
                      <th className="px-3 py-3">Status</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800/80">
                    {rows.map((r, i) => {
                      const it = r.it
                      const price = fmtPrice(it?.price, r.currency)
                      const chg = it?.change
                      const pct = it?.changePct
                      const isFav = favSet.has(`${r.market}::${r.symbol}`)

                      return (
                        <tr key={`${r.market}::${r.symbol}`} className="hover:bg-gray-50 dark:hover:bg-slate-800/60">
                          <td className="px-3 py-3 text-gray-500 dark:text-slate-400">{i + 1}</td>

                          <td className="px-2 py-3 text-center">
                            <button
                              onClick={e => {
                                e.preventDefault()
                                e.stopPropagation()
                                void toggleFav(r.market, r.symbol)
                              }}
                              aria-pressed={isFav}
                              title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                              className={[
                                'inline-flex items-center justify-center',
                                'h-6 w-6 rounded transition',
                                'hover:bg-black/5 dark:hover:bg-white/10',
                                isFav ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500',
                              ].join(' ')}
                            >
                              <span aria-hidden className="leading-none">
                                {isFav ? '★' : '☆'}
                              </span>
                            </button>
                          </td>

                          <td className="px-2 py-3">
                            <span className="inline-flex rounded-full border border-gray-200 dark:border-slate-700 px-2 py-1 text-xs text-gray-700 dark:text-slate-200">
                              {r.market}
                            </span>
                          </td>

                          <td className="px-2 py-3">
                            {r.href !== '#' ? (
                              <Link href={r.href} className="font-medium text-gray-900 dark:text-slate-100 hover:underline">
                                {r.disp}
                              </Link>
                            ) : (
                              <span className="font-medium text-gray-900 dark:text-slate-100">{r.disp}</span>
                            )}
                            <span className="ml-2 text-gray-500 dark:text-slate-400">({r.symbol})</span>
                          </td>

                          <td className="px-3 py-3 text-gray-900 dark:text-slate-100 whitespace-nowrap">{price}</td>

                          <td className={`px-3 py-3 whitespace-nowrap ${pctCls(pct)}`}>
                            {Number.isFinite(chg as number) && Number.isFinite(pct as number)
                              ? `${chg! >= 0 ? '+' : ''}${num(chg, 2)} (${pct! >= 0 ? '+' : ''}${num(pct, 2)}%)`
                              : '—'}
                          </td>

                          <td className={`px-3 py-3 whitespace-nowrap ${pctCls(r.r7)}`}>
                            {Number.isFinite(r.r7 as number) ? `${(r.r7 as number) >= 0 ? '+' : ''}${num(r.r7, 2)}%` : '—'}
                          </td>

                          <td className={`px-3 py-3 whitespace-nowrap ${pctCls(r.r30)}`}>
                            {Number.isFinite(r.r30 as number) ? `${(r.r30 as number) >= 0 ? '+' : ''}${num(r.r30, 2)}%` : '—'}
                          </td>

                          <td className="px-3 py-3 whitespace-nowrap">
                            {Number.isFinite(r.score) ? <ScoreBadge score={r.score} /> : <span className="badge badge-hold">HOLD · 50</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </main>
    </>
  )
}