// src/pages/crypto.tsx
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import ScoreBadge from '@/components/ScoreBadge'
import { COINS } from '@/lib/coins'
import { computeScoreStatus } from '@/lib/taScore'

type IndResp = {
  symbol: string // BINANCE pair echo, bv. BTCUSDT
  ma?: { ma50: number|null; ma200: number|null }
  rsi?: number|null
  macd?: { macd: number|null; signal: number|null; hist: number|null }
  volume?: { volume: number|null; avg20d: number|null; ratio: number|null }
  error?: string
}

const toBinancePair = (symbol: string) => {
  const s = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const skip = new Set(['USDT','USDC','BUSD','DAI','TUSD'])
  if (!s || skip.has(s)) return null
  return `${s}USDT`
}

export default function CryptoOverview() {
  // minute-based tag to bust any accidental caches
  const [tick, setTick] = useState(Math.floor(Date.now()/60_000))
  useEffect(() => {
    const id = setInterval(() => setTick(Math.floor(Date.now()/60_000)), 60_000)
    return () => clearInterval(id)
  }, [])

  const pairs = useMemo(() => {
    return COINS.map(c => {
      const base = (c.symbol || '').replace('-USD','').toUpperCase()
      return { c, pair: toBinancePair(base) }
    }).filter(x => !!x.pair) as { c: { symbol: string; name: string }, pair: string }[]
  }, [])

  const [rows, setRows] = useState<{ name: string; symbol: string; score: number }[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        setLoading(true)
        const batchSize = 12
        const batches: string[][] = []
        for (let i = 0; i < pairs.length; i += batchSize) {
          batches.push(pairs.slice(i, i+batchSize).map(x => x.pair))
        }

        const all: { name: string; symbol: string; score: number }[] = []
        for (const b of batches) {
          const url = `/api/crypto-light/indicators?symbols=${encodeURIComponent(b.join(','))}&v=${tick}`
          const r = await fetch(url, { cache: 'no-store' })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const j = await r.json() as { results?: IndResp[] }

          for (const ind of (j.results || [])) {
            const map = pairs.find(p => p.pair === ind.symbol)
            if (!map) continue
            const { score } = computeScoreStatus({
              ma: ind.ma, rsi: ind.rsi, macd: ind.macd, volume: ind.volume
            } as any)
            all.push({ name: map.c.name, symbol: map.c.symbol, score })
          }
        }
        if (!aborted) setRows(all)
      } catch {
        if (!aborted) setRows([])
      } finally {
        if (!aborted) setLoading(false)
      }
    })()
    return () => { aborted = true }
  }, [pairs, tick])

  const sorted = useMemo(() => {
    return [...rows].sort((a,b) => b.score - a.score)
  }, [rows])

  return (
    <>
      <Head>
        <title>Crypto — Live Signals</title>
      </Head>
      <main className="max-w-5xl mx-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Crypto (live)</h1>
          <Link href="/" className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 bg-white/10 text-white/80 ring-1 ring-white/15 hover:bg-white/15 transition">
            ← Home
          </Link>
        </div>

        <div className="table-card p-0 overflow-hidden">
          <div className="grid grid-cols-12 px-3 py-2 text-white/60 text-xs border-b border-white/10">
            <div className="col-span-6 sm:col-span-7">Name</div>
            <div className="col-span-3 sm:col-span-3">Symbol</div>
            <div className="col-span-3 sm:col-span-2 text-right">Score</div>
          </div>

          {loading && sorted.length === 0 ? (
            <div className="px-3 py-4 text-white/60 text-sm">Loading...</div>
          ) : (
            <ul className="divide-y divide-white/8">
              {sorted.map((r) => (
                <li key={r.symbol} className="px-3 py-2 hover:bg-white/5 transition">
                  <div className="grid grid-cols-12 items-center">
                    <div className="col-span-6 sm:col-span-7">
                      <Link href={`/crypto/${r.symbol.toLowerCase()}`} className="hover:underline font-medium">{r.name}</Link>
                    </div>
                    <div className="col-span-3 sm:col-span-3 text-white/70">{r.symbol}</div>
                    <div className="col-span-3 sm:col-span-2 flex justify-end">
                      <ScoreBadge score={r.score} />
                    </div>
                  </div>
                </li>
              ))}
              {sorted.length === 0 && !loading && (
                <li className="px-3 py-4 text-white/60 text-sm">Geen data.</li>
              )}
            </ul>
          )}
        </div>
      </main>
    </>
  )
}