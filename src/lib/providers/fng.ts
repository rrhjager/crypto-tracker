export async function getFearGreed(){
  const r = await fetch('https://api.alternative.me/fng/');
  if (!r.ok) return { value: 50, timestamp: Date.now() };
  const j = await r.json().catch(()=>({data:[]}));
  const it = j.data?.[0] || j[0] || j;
  const value = Number(it?.value || 50);
  const timestamp = Number(it?.timestamp ? it.timestamp * 1000 : Date.now());
  return { value, timestamp };
}

// Helper: map 0..100 -> score 0.2..0.8 (neutraal ~0.8, extreem ~0.2)
export function fngToScore(v: number): number {
  const closeness = 1 - Math.abs((v - 50) / 50); // 1 at 50, 0 at 0/100
  return 0.2 + 0.6 * Math.max(0, Math.min(1, closeness)); // 0.2..0.8
}