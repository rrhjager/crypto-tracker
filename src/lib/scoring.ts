import { WEIGHTS } from "./weights";

export type ComponentScoreNullable = {
  tvSignal: number | null;
  arbitrage: number | null;
  tokenUnlocks: number | null;
  whales: number | null;
  riskAlt: number | null;
  pumpDump: number | null;
  newsImpact: number | null;
  portfolioStress: number | null;
  fearGreed: number | null;
  yield: number | null;
};

export type ScoreOut = {
  total: number;                     // 0..100
  status: 'BUY'|'HOLD'|'SELL';
  breakdown: ComponentScoreNullable; // null = N/A
};

export function combineScores(s: ComponentScoreNullable): ScoreOut {
  const entries = Object.entries(s) as [keyof ComponentScoreNullable, number | null][];
  let wSum = 0, acc = 0;
  for (const [k,v] of entries) {
    if (v == null) continue;
    const w = (WEIGHTS as any)[k] as number;
    if (!w) continue;
    wSum += w; acc += v * w;
  }
  const norm = wSum > 0 ? acc / wSum : 0.5; // alles N/A → neutraal
  const total = Math.round(norm * 100);
  const status: 'BUY'|'HOLD'|'SELL' = total>=66 ? 'BUY' : total<=33 ? 'SELL' : 'HOLD';
  return { total, status, breakdown: s };
}