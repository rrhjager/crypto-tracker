// src/pages/stocks/[symbol].tsx
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import StockIndicatorCard from '@/components/StockIndicatorCard'
import ScoreBadge from '@/components/ScoreBadge'
import { AEX } from '@/lib/aex'

type Advice = 'BUY' | 'HOLD' | 'SELL'

type MaCrossResp = {
  symbol: string
  ma50: number | null
  ma200: number | null
  status: Advice
  points: number
}
type RsiResp = {
  symbol: string
  period: number
  rsi: number | null
  status: Advice
  points: number
}
type MacdResp = {
  symbol: string
  fast: number
  slow: number
  signalPeriod: number
  macd: number | null
  signal: number | null
  hist: number | null
  status: Advice
  points: number
}
type Vol20Resp = {
  symbol: string
  period: number
  volume: number | null
  avg20: number | null
  ratio: number | null
  status: Advice
  points: number
}

export default function StockDetail() {
  const router = useRouter()
  const symbol = (router.query.symbol as string) || ''
  const meta = useMemo(() => AEX.find(t => t.symbol === symbol), [symbol])

  const [ma, setMa] = useState<MaCrossResp | null>(null)
  const [rsi, setRsi] = useState<RsiResp | null>(null)
  const [macd, setMacd] = useState<MacdResp | null>(null)
  const [vol20, setVol20] = useState<Vol20Resp | null>(null)

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!symbol) return
    let aborted = false
    ;(async () => {
      try {
        setLoading(true)
        setErr(null)

        const [rMa, rRsi, rMacd, rVol] = await Promise.all([
          fetch(`/api/indicators/ma-cross/${encodeURIComponent(symbol)}`, { cache: 'no-store' }),
          fetch(`/api/indicators/rsi/${encodeURIComponent(symbol)}?period=14`, { cache: 'no-store' }),
          fetch(`/api/indicators/macd/${encodeURIComponent(symbol)}?fast=12&slow=26&signal=9`, { cache: 'no-store' }),
          fetch(`/api/indicators/vol20/${encodeURIComponent(symbol)}?period=20`, { cache: 'no-store' }),
        ])

        if (!rMa.ok) throw new Error(`MA HTTP ${rMa.status}`)
        if (!rRsi.ok) throw new Error(`RSI HTTP ${rRsi.status}`)
        if (!rMacd.ok) throw new Error(`MACD HTTP ${rMacd.status}`)
        if (!rVol.ok) throw new Error(`VOL HTTP ${rVol.status}`)

        const [jMa, jRsi, jMacd, jVol] = await Promise.all([
          rMa.json(), rRsi.json(), rMacd.json(), rVol.json()
        ]) as [MaCrossResp, RsiResp, MacdResp, Vol20Resp]

        if (!aborted) {
          setMa(jMa); setRsi(jRsi); setMacd(jMacd); setVol20(jVol)
        }
      } catch (e: any) {
        if (!aborted) setErr(String(e?.message || e))
      } finally {
        if (!aborted) setLoading(false)
      }
    })()
    return () => { aborted = true }
  }, [symbol])

  // Samengesteld totaal-advies (MA 40%, MACD 30%, RSI 20%, Volume 10%)
  const totalScore = useMemo(() => {
    const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
    const toPts = (status?: Advice, pts?: number | null) => {
      if (Number.isFinite(pts as number)) return clamp(Number(pts), -2, 2)
      if (status === 'BUY') return 2
      if (status === 'SELL') return -2
      return 0
    }

    const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
    const pMA   = toPts(ma?.status,   ma?.points)
    const pMACD = toPts(macd?.status, macd?.points)
    const pRSI  = toPts(rsi?.status,  rsi?.points)
    const pVOL  = toPts(vol20?.status,vol20?.points)

    const nMA   = (pMA   + 2) / 4
    const nMACD = (pMACD + 2) / 4
    const nRSI  = (pRSI  + 2) / 4
    const nVOL  = (pVOL  + 2) / 4

    const agg = W_MA*nMA + W_MACD*nMACD + W_RSI*nRSI + W_VOL*nVOL
    return Math.round(agg * 100)
  }, [ma, macd, rsi, vol20])

  return (
    <main className="min-h-screen bg-ink text-white">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Header zonder extra badge (alleen naam + ticker) */}
        <header className="space-y-1">
          <h1 className="hero">{meta?.name || 'Onbekend aandeel'}</h1>
          <p className="sub">{symbol}</p>
        </header>

        {/* Één plek voor totaal-advies (zoals crypto) */}
        <div className="table-card flex items-center justify-between">
          <div className="font-semibold">Totaal advies</div>
          {!loading && !err ? (
            <ScoreBadge score={totalScore} />
          ) : (
            <span className="badge badge-hold">HOLD · 50</span>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* MA */}
          <StockIndicatorCard
            title="MA50 vs MA200 (Golden/Death Cross)"
            status={loading ? 'HOLD' : err ? 'HOLD' : (ma?.status || 'HOLD')}
            note={
              loading
                ? 'Bezig met ophalen...'
                : err
                  ? `Fout: ${err}`
                  : ma
                    ? (ma.ma50 != null && ma.ma200 != null
                        ? `MA50: ${ma.ma50.toFixed(2)} — MA200: ${ma.ma200.toFixed(2)}`
                        : 'Nog onvoldoende data om MA50/MA200 te bepalen')
                    : '—'
            }
          />

          {/* RSI */}
          <StockIndicatorCard
            title="RSI (14)"
            status={loading ? 'HOLD' : err ? 'HOLD' : (rsi?.status || 'HOLD')}
            note={
              loading
                ? 'Bezig met ophalen...'
                : err
                  ? `Fout: ${err}`
                  : rsi && rsi.rsi != null
                    ? `RSI: ${rsi.rsi.toFixed(2)}`
                    : 'Onvoldoende data voor RSI'
            }
          />

          {/* MACD */}
          <StockIndicatorCard
            title="MACD (12/26/9)"
            status={loading ? 'HOLD' : err ? 'HOLD' : (macd?.status || 'HOLD')}
            note={
              loading
                ? 'Bezig met ophalen...'
                : err
                  ? `Fout: ${err}`
                  : macd en macd.macd != null en macd.signal != null
                    ? `MACD: ${macd.macd.toFixed(4)} — Signaal: ${macd.signal.toFixed(4)} — Hist: ${(macd.hist ?? 0).toFixed(4)}`
                    : 'Onvoldoende data voor MACD'
            }
          />

          {/* Volume vs 20d */}
          <StockIndicatorCard
            title="Volume vs 20d gemiddelde"
            status={loading ? 'HOLD' : err ? 'HOLD' : (vol20?.status || 'HOLD')}
            note={
              loading
                ? 'Bezig met ophalen...'
                : err
                  ? `Fout: ${err}`
                  : vol20 en vol20.volume != null en vol20.avg20 != null
                    ? `Volume: ${Math.round(vol20.volume).toLocaleString()} — Gem.20d: ${Math.round(vol20.avg20).toLocaleString()} — Ratio: ${(vol20.ratio ?? 0).toFixed(2)}`
                    : 'Onvoldoende data voor volume'
            }
          />
        </div>

        <div className="flex gap-3">
          {/* ⬇️ Alleen deze twee knoppen aangepast: Engels + grijze stijl */}
          <Link href="/stocks" className="btn btn-secondary">← Back to AEX list</Link>
          <Link href="/" className="btn btn-secondary">Go to homepage</Link>
        </div>
      </div>
    </main>
  )
}