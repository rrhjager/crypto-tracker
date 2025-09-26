// src/components/ScoreBadge.tsx
export default function ScoreBadge({ score }: { score: number }) {
    const s = score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD'
  
    const base =
      'inline-flex items-center justify-center gap-1 rounded-full border ' +
      'font-semibold uppercase tracking-wide text-[11px] leading-none ' +
      'px-2.5 py-1 h-7 whitespace-nowrap'
  
    const tone =
      s === 'BUY'
        ? 'bg-green-500/10 text-green-700 border-green-500/30'
        : s === 'SELL'
          ? 'bg-red-500/10 text-red-700 border-red-500/30'
          : 'bg-amber-500/10 text-amber-700 border-amber-500/30'
  
    return (
      <span className={`${base} ${tone}`}>
        <span>{s}</span>
        <span className="opacity-60">·</span>
        <span className="tabular-nums">{score}</span>
      </span>
    )
  }