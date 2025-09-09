const BASE = "https://api.unlocks.app";
const KEY = process.env.TOKENOMIST_API_KEY || "";

export type UnlockEvent = { date: string; amountUsd?: number; token?: string; type?: string };

export async function nextUnlocks(tokenId: string): Promise<UnlockEvent[]> {
  if (!KEY || !tokenId) return [];
  const url = `${BASE}/v2/unlock/events?tokenId=${encodeURIComponent(tokenId)}`;
  const res = await fetch(url, { headers: { "x-api-key": KEY } });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.data) ? data.data.slice(0,5) : [];
}

export function unlocksScore(events: UnlockEvent[]): number | null {
  if (!events || events.length === 0) return null;
  const now = Date.now();
  const near = events
    .map(e => ({ ...e, t: Date.parse(e.date || "") }))
    .filter(e => isFinite(e.t))
    .sort((a,b)=>a.t-b.t)[0];
  if (!near) return null;

  const days = Math.max(0, (near.t - now) / (1000*60*60*24));
  const usd  = Number(near.amountUsd || 0);

  const timeFactor = Math.max(0, Math.min(1, (days / 30)));
  const sizeFactor = Math.max(0, Math.min(1, 1 - (usd / 10_000_000)));
  const score = 0.1 + 0.8 * ((timeFactor + sizeFactor) / 2);
  return Math.max(0, Math.min(1, score));
}