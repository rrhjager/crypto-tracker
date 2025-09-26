// src/components/StockIndicatorCard.tsx
type Props = { title: string; status: 'BUY' | 'HOLD' | 'SELL'; note?: string }

export default function StockIndicatorCard({ title, status, note }: Props) {
  const badge =
    status === 'BUY' ? 'badge-buy' : status === 'SELL' ? 'badge-sell' : 'badge-hold'

  return (
    <div className="table-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span className={`badge ${badge}`}>{status}</span>
      </div>
      {note && <p className="text-sm sub mt-2">{note}</p>}
    </div>
  )
}