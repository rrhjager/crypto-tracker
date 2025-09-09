// Lightweight spot klines (public, no key)
type Kline = { openTime: number; open: number; high: number; low: number; close: number; volume: number; closeTime: number };

export async function fetchSpotKlines(symbol?: string, interval: string = "1h", limit: number = 180): Promise<Kline[]> {
  if (!symbol) return [];
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${Math.max(50, Math.min(1000, limit))}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Binance klines ${r.status}`);
  const arr = await r.json();
  if (!Array.isArray(arr)) return [];
  return arr.map((k: any[]) => ({
    openTime: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeTime: k[6],
  }));
}