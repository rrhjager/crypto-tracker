// src/components/SignalHeatmap.tsx
import Link from 'next/link'

type CoinRow = {
  slug: string
  symbol: string
  name: string
  status: 'BUY' | 'HOLD' | 'SELL'
  score: number
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

// Geef een HSL-kleur per status; intensiteit ~ score
function cellColor(status: 'BUY'|'HOLD'|'SELL', score: number) {
  const s = clamp(score, 0, 100)
  let hue = 38, sat = 70, light = 42 // HOLD basis (amber)
  if (status === 'BUY') {
    hue = 142; sat = 65
    const t = clamp((s - 66) / 34, 0, 1) // 66..100
    light = 42 - 10 * t                 // hoe hoger score, hoe donkerder groen
  } else if (status === 'SELL') {
    hue = 0; sat = 70
    const t = clamp((33 - s) / 33, 0, 1) // 0..33
    light = 42 - 10 * t                  // hoe lager score, hoe donkerder rood
  }
  return `hsl(${hue} ${sat}% ${light}%)`
}

export default function SignalHeatmap({ coins }: { coins: CoinRow[] }) {
  if (!coins || coins.length === 0) return null

  return (
    <section className="table-card mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold">Stoplicht — in één oogopslag</h3>
        <div className="flex items-center gap-2 text-xs text-white/70">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: 'hsl(142 65% 36%)' }} />
            BUY
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: 'hsl(38 70% 42%)' }} />
            HOLD
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: 'hsl(0 70% 36%)' }} />
            SELL
          </span>
        </div>
      </div>

      <div
        className="
          grid gap-2
          [grid-template-columns:repeat(auto-fit,minmax(110px,1fr))]
        "
      >
        {coins.map((c) => (
          <Link
            key={c.slug}
            href={`/coin/${c.slug}`}
            title={`${c.name} (${c.symbol}) • ${c.status} · ${Math.round(c.score)} `}
            className="
              group rounded-xl p-3 text-center
              ring-1 ring-white/10 hover:ring-white/30
              transition-shadow duration-200
              shadow-sm hover:shadow
            "
            style={{ backgroundColor: cellColor(c.status, Number(c.score || 0)), color: '#fff' }}
          >
            <div className="text-xs/4 opacity-85">{c.name}</div>
            <div className="text-lg font-extrabold tracking-wide">{c.symbol}</div>
            <div className="mt-1 text-[11px] uppercase tracking-wider opacity-90">
              {c.status} · {Math.round(Number(c.score ?? 0))}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}