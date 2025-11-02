// src/components/StockChart.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'

type Point = { t: number; c?: number }
type ApiResp = { symbol: string; range: string; interval: string; points: Point[] }

type Props = {
  symbol: string
  range?: '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | 'max'
  interval?: '1d' | '1wk' | '1mo'
  height?: number
  className?: string
}

const fmtNum = (n: number) => {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

export default function StockChart({ symbol, range = '6mo', interval = '1d', height = 160, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(360)
  const [data, setData] = useState<Point[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // responsive width
  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(100, Math.floor(e.contentRect.width)))
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  // fetch data
  useEffect(() => {
    let aborted = false
    setLoading(true); setErr(null)
    ;(async () => {
      try {
        const url = `/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`
        const r = await fetch(url, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = (await r.json()) as ApiResp
        const pts = (j.points || []).filter(p => Number.isFinite(p.c as number)) as Required<Point>[]
        if (!aborted) setData(pts)
      } catch (e: any) {
        if (!aborted) setErr(String(e?.message || e))
      } finally {
        if (!aborted) setLoading(false)
      }
    })()
    return () => { aborted = true }
  }, [symbol, range, interval])

  const { min, max } = useMemo(() => {
    const vals = data.map(p => p.c)
    const mn = Math.min(...vals)
    const mx = Math.max(...vals)
    return { min: Number.isFinite(mn) ? mn : 0, max: Number.isFinite(mx) ? mx : 1 }
  }, [data])

  // draw
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1))
    el.width = w * dpr
    el.height = height * dpr
    el.style.width = `${w}px`
    el.style.height = `${height}px`
    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    // bg (transparent, integrate with card)
    ctx.clearRect(0, 0, w, height)

    if (!data.length) {
      // baseline
      ctx.strokeStyle = 'rgba(0,0,0,0.1)'
      ctx.beginPath()
      ctx.moveTo(8, height - 20)
      ctx.lineTo(w - 8, height - 20)
      ctx.stroke()
      return
    }

    const padL = 8, padR = 8, padT = 6, padB = 22
    const W = Math.max(1, w - padL - padR)
    const H = Math.max(1, height - padT - padB)
    const y = (v: number) => {
      const norm = (v - min) / (max - min || 1)
      return padT + (1 - norm) * H
    }
    const x = (i: number) => padL + (i / Math.max(1, data.length - 1)) * W

    // area gradient
    const g = ctx.createLinearGradient(0, padT, 0, padT + H)
    g.addColorStop(0, 'rgba(59,130,246,0.35)')     // blue-500 ~ top
    g.addColorStop(1, 'rgba(59,130,246,0.04)')     // fade

    // path
    ctx.beginPath()
    ctx.moveTo(x(0), y(data[0].c))
    for (let i = 1; i < data.length; i++) ctx.lineTo(x(i), y(data[i].c))
    // stroke
    ctx.lineWidth = 1.6
    ctx.strokeStyle = 'rgba(59,130,246,0.9)'
    ctx.stroke()
    // fill area
    ctx.lineTo(x(data.length - 1), padT + H)
    ctx.lineTo(x(0), padT + H)
    ctx.closePath()
    ctx.fillStyle = g
    ctx.fill()

    // min/max labels (subtle)
    ctx.fillStyle = 'rgba(107,114,128,0.9)' // gray-500
    ctx.font = '10px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
    ctx.textAlign = 'left'
    ctx.fillText(fmtNum(min), 8, height - 6)
    ctx.textAlign = 'right'
    ctx.fillText(fmtNum(max), w - 8, 10)

  }, [data, w, height, min, max])

  return (
    <div ref={wrapRef} className={className}>
      {loading && <div className="text-[11px] text-gray-500">Chart laden…</div>}
      {err && <div className="text-[11px] text-red-600">Chart fout: {err}</div>}
      <canvas ref={canvasRef} />
    </div>
  )
}