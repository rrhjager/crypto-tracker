// src/pages/nikkei225/[symbol].tsx
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import StockIndicatorCard from '@/components/StockIndicatorCard'
import { NIKKEI225 } from '@/lib/nikkei225'
import ScoreBadge from '@/components/ScoreBadge'

type Advice = 'BUY' | 'HOLD' | 'SELL'
type MaCrossResp = { symbol: string; ma50: number | null; ma200: number | null; status: Advice; points: number }
type RsiResp    = { symbol: string; period: number; rsi: number | null; status: Advice; points: number }
type MacdResp   = { symbol: string; fast: number; slow: number; signalPeriod: number; macd: number | null; signal: number | null; hist: number | null; status: Advice; points: number }
type Vol20Resp  = { symbol: string; period: number; volume: number | null; avg20: number | null; ratio: number | null; status: Advice; points: number }

export default function StockDetail() {
  const router = useRouter()
  const symbol = (router.query.symbol as string) || ''
  const meta = useMemo(() => NIKKEI225.find(t => t.symbol === symbol), [symbol])

  const [ma, setMa] = useState<MaCrossResp | null>(null)
  const [rsi, setRsi] = useState<RsiResp | null>(null)
  const [macd, setMacd] = useState<MacdResp | null>(null)
  const [vol20, setVol20] = useState<Vol20Resp | null>(null)

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // gecombineerde score (zelfde wegingen als de lijst)
  const W_MA = 0.40, W_MACD = 0.30, W_RSI = 0.20, W_VOL = 0.10
  const toPts = (s?: Advice, p?: number | null) => {
    if (Number.isFinite(p as number)) return Math.max(-2, Math.min(2, Number(p)))
    if (s === 'BUY') return 2
    if (s === 'SELL') return -2
    return 0
  }
  const toScore = () => {
    const nMA   = (toPts(ma?.status, ma?.points)     + 2) / 4
    const nMACD = (toPts(macd?.status, macd?.points) + 2) / 4
    const nRSI  = (toPts(rsi?.status, rsi?.points)   + 2) / 4
    const nVOL  = (toPts(vol20?.status, vol20?.points)+2) / 4
    const agg = W_MA*nMA + W_MACD*nMACD + W_RSI*nRSI + W_VOL*nVOL
    return Math.round(agg * 100)
  }

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

        if (!aborted) { setMa(jMa); setRsi(jRsi); setMacd(jMacd); setVol20(jVol) }
      } catch (e: any) {
        if (!aborted) setErr(String(e?.message || e))
      } finally {
        if (!aborted) setLoading(false)
      }
    })()
    return () => { aborted = true }
  }, [symbol])

  const combinedScore = toScore()

  return (
    <main className="min-h-screen bg-ink text-white">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="hero">{meta?.name || 'Onbekend aandeel'}</h1>
              <p className="sub">{symbol}</p>
            </div>
            {/* Alleen het samengestelde advies rechtsboven tonen (zoals afgesproken) */}
            {Number.isFinite(combinedScore as number) && (
              <ScoreBadge score={combinedScore} />
            )}
          </div>
        </header>

        <div className="grid md:grid-cols-2 gap-4">
          <StockIndicatorCard
            title="MA50 vs MA200 (Golden/Death Cross)"
            status={loading ? 'HOLD' : err ? 'HOLD' : (ma?.status || 'HOLD')}
            note={
              loading ? 'Bezig met ophalen...' :
              err ? `Fout: ${err}` :
              ma && ma.ma50 != null && ma.ma200 != null
                ? `MA50: ${ma.ma50.toFixed(2)} — MA200: ${ma.ma200.toFixed(2)}`
                : 'Onvoldoende data voor MA50/MA200'
            }
          />
          <StockIndicatorCard
            title="RSI (14)"
            status={loading ? 'HOLD' : err ? 'HOLD' : (rsi?.status || 'HOLD')}
            note={
              loading ? 'Bezig met ophalen...' :
              err ? `Fout: ${err}` :
              rsi && rsi.rsi != null
                ? `RSI: ${rsi.rsi.toFixed(2)}`
                : 'Onvoldoende data voor RSI'
            }
          />
          <StockIndicatorCard
            title="MACD (12/26/9)"
            status={loading ? 'HOLD' : err ? 'HOLD' : (macd?.status || 'HOLD')}
            note={
              loading ? 'Bezig met ophalen...' :
              err ? `Fout: ${err}` :
              macd && macd.macd != null && macd.signal != null
                ? `MACD: ${macd.macd.toFixed(4)} — Signaal: ${macd.signal.toFixed(4)} — Hist: ${(macd.hist ?? 0).toFixed(4)}`
                : 'Onvoldoende data voor MACD'
            }
          />
          <StockIndicatorCard
            title="Volume vs 20d gemiddelde"
            status={loading ? 'HOLD' : err ? 'HOLD' : (vol20?.status || 'HOLD')}
            note={
              loading ? 'Bezig met ophalen...' :
              err ? `Fout: ${err}` :
              vol20 && vol20.volume != null && vol20.avg20 != null
                ? `Volume: ${Math.round(vol20.volume).toLocaleString()} — Gem.20d: ${Math.round(vol20.avg20).toLocaleString()} — Ratio: ${(vol20.ratio ?? 0).toFixed(2)}`
                : 'Onvoldoende data voor volume'
            }
          />
        </div>

        <div className="flex gap-3">
          <Link href="/nikkei225" className="btn">← Terug naar Nikkei-lijst</Link>
          <Link href="/" className="btn">Naar homepage</Link>
        </div>
      </div>
    </main>
  )
}