// src/lib/scoring.ts
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
  status: "BUY" | "HOLD" | "SELL";
  breakdown: ComponentScoreNullable; // null = N/A
};

// ---- helpers ----------------------------------------------------
const isFiniteNum = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);

function combineObject(o: ComponentScoreNullable): ScoreOut {
  const entries = Object.entries(o) as [keyof ComponentScoreNullable, number | null][];
  let wSum = 0;
  let acc = 0;

  for (const [k, v] of entries) {
    if (v == null || !isFiniteNum(v)) continue;
    const w = (WEIGHTS as Record<string, number>)[k as string] || 0;
    if (!w) continue;
    wSum += w;
    acc += v * w; // v is 0..100 in dit model
  }

  const norm01 = wSum > 0 ? acc / wSum : 0.5;
  const total = Math.round(norm01);
  const status: "BUY" | "HOLD" | "SELL" =
    total >= 66 ? "BUY" : total <= 33 ? "SELL" : "HOLD";

  return { total, status, breakdown: o };
}

/**
 * Backwards-compatible combine:
 * - accepteert ofwel één object, of een array (waarbij het 1e element wordt gebruikt).
 *   Dit dekt oude aanroepen waar per ongeluk een array werd doorgegeven.
 */
export function combineScores(
  input: ComponentScoreNullable | ComponentScoreNullable[]
): ScoreOut {
  const obj: ComponentScoreNullable =
    Array.isArray(input) ? (input[0] ?? ({} as ComponentScoreNullable)) : input;
  return combineObject(obj);
}