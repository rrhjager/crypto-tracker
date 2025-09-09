// src/pages/api/v1/refresh.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { COINS } from "@/lib/coins";
import { setCache } from "@/lib/cache";

import { tvSignalScore } from "@/lib/providers/tv";
import { getFearGreed } from "@/lib/providers/fng";

import { fetchSpotKlines } from "@/lib/providers/binance";
import { latestFundingRate, currentOpenInterest, globalLongShortSkew } from "@/lib/providers/binanceFutures";
import { momentumScoreFromCloses } from "@/lib/indicators/momentum";
import { combineScores, ComponentScoreNullable } from "@/lib/scoring";

// DeFiLlama
import { topPoolsForSymbol } from "@/lib/providers/defillama";

export const config = { maxDuration: 60 };

async function safe<T>(p: Promise<T>, fb: T): Promise<T> { try { return await p } catch { return fb } }

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────

// σ van log-returns over de laatste N candles (ruwe volatiliteit, geen 0..1)
function rawVolatilityFromCloses(closes: number[], lookback = 72): number | null {
  const n = Math.min(lookback, closes.length - 1);
  if (n <= 5) return null;
  const start = closes.length - 1 - n;
  const rets: number[] = [];
  for (let i = start + 1; i <= start + n; i++) {
    const p0 = closes[i - 1], p1 = closes[i];
    if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0 || p1 <= 0) continue;
    rets.push(Math.log(p1 / p0));
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const stdev = Math.sqrt(Math.max(variance, 0));
  return Number.isFinite(stdev) ? stdev : null;
}

// Normaliseer een lijst ruwe waarden naar 0..1 via min-max (safe)
function minMaxNormalize(values: Array<number | null | undefined>): number[] {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!xs.length) return values.map(() => 0.5);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  if (max - min < 1e-12) return values.map(() => 0.5);
  return values.map(v => (typeof v === "number" ? (v - min) / (max - min) : 0.5));
}

// % change tov N candles terug
function pctChangeFromCloses(closes: number[], lookback: number): number {
  if (!Array.isArray(closes) || closes.length <= lookback) return 0;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - lookback];
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return 0;
  return ((last - prev) / prev) * 100;
}

// eenvoudige percentiel helper (0..1 kwantiel)
function percentile(sortedAsc: number[], q: number): number {
  if (!sortedAsc.length) return 0;
  const i = Math.round(q * (sortedAsc.length - 1));
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, i))];
}

// ───────────────────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const q = String(req.query.debug || "").toLowerCase();
    const DEBUG = q === "1" || q === "true";

    // 1) Market Fear & Greed (0..1)
    const fng = await safe(getFearGreed(), { value: 50 } as any);
    const fngVal = Number((fng as any)?.value ?? 50);
    const fearGreed = 1 - Math.abs((fngVal / 100) - 0.5) * 2;

    // 2) Klines ophalen (180×1h voor signalen, 60×1d voor 30d perf)
    const klinesByCoin = await Promise.all(
      COINS.map(async (coin) => {
        const symbol = coin.pairUSD?.binance;
        if (!symbol) return { coin, closes1h: [] as number[], closes1d: [] as number[] };

        const ks1h = await safe(fetchSpotKlines(symbol, "1h", 180), []);
        const ks1d = await safe(fetchSpotKlines(symbol, "1d", 60), []);

        const closes1h = ks1h.map(k => k.close).filter(Number.isFinite);
        const closes1d = ks1d.map(k => k.close).filter(Number.isFinite);
        return { coin, closes1h, closes1d };
      })
    );

    // 3) Lokale signalen + pools
    type Pre = {
      coin: (typeof COINS)[number];
      closes1h: number[];
      closes1d: number[];
      tv: number | null;
      momentum: number | null;
      rawVol: number | null;
      funding: number | null;
      oi: number | null;
      lsr: number | null;
      pools: any[];
      bestApyEff: number | null; // robuuste “beste” APY per coin
    };

    const prelim: Pre[] = await Promise.all(
      klinesByCoin.map(async ({ coin, closes1h, closes1d }) => {
        const momentum = closes1h.length ? momentumScoreFromCloses(closes1h) : null;
        const rawVol   = closes1h.length ? rawVolatilityFromCloses(closes1h, 72) : null;
        const tv       = await safe(tvSignalScore(coin.pairUSD?.binance), null);

        const funding  = await safe(latestFundingRate(coin.pairUSD?.binance), null);
        const oi       = await safe(currentOpenInterest(coin.pairUSD?.binance), null);
        const lsr      = await safe(globalLongShortSkew(coin.pairUSD?.binance), null);

        const pools    = await safe(topPoolsForSymbol(coin.symbol, { minTvlUsd: 3_000_000, maxPools: 6 }), []);

        // Robuuste “beste APY”: combineer base+reward en penaliseer risicovoller
        let bestApyEff: number | null = null;
        for (const p of Array.isArray(pools) ? pools : []) {
          const apy = Number.isFinite(Number(p?.apy))
            ? Number(p.apy)
            : Number(p?.apyBase || 0) + Number(p?.apyReward || 0);

          const tvl = Number(p?.tvlUsd || 0);
          if (!Number.isFinite(apy) || apy <= 0 || tvl < 3_000_000) continue;

          let qual = 1;
          if (p?.stablecoin === true) qual *= 0.85;                 // stables iets omlaag
          if (String(p?.ilRisk).toLowerCase() === "yes") qual *= 0.70; // IL-risk sterker omlaag

          const eff = apy * qual;
          bestApyEff = Math.max(bestApyEff ?? 0, eff);
        }

        return { coin, closes1h, closes1d, tv, momentum, rawVol, funding, oi, lsr, pools, bestApyEff };
      })
    );

    // 4) Breadth (marktbreedte) – aandeel coins met momentum ≥ 0.6
    const momentumScores = prelim.map(p => (typeof p.momentum === "number" ? p.momentum : 0));
    const greenCount = momentumScores.filter(m => m >= 0.6).length;
    const breadth = COINS.length ? greenCount / COINS.length : 0.5;

    // 5) Volatility Regime: cross-sectionele normalisatie + demping
    const rawVols = prelim.map(p => p.rawVol);
    const volNorm01 = minMaxNormalize(rawVols); // 0 (laagst) .. 1 (hoogst)
    // lager σ ⇒ hoger; daarna dempen naar 0.3..0.7 en bij bearish momentum max 0.6
    const volRegScores = volNorm01.map((v, i) => {
      let s = 1 - v;                        // 0..1
      s = 0.3 + 0.4 * s;                    // 0.3..0.7
      const mom = typeof prelim[i].momentum === "number" ? prelim[i].momentum : 0.5;
      if (mom < 0.45) s = Math.min(s, 0.6); // cap bij bearish trend
      return s;
    });

    // 6) Yield-schaal op basis van percentielen over alle coins
    const apysAll = prelim
      .map(p => (typeof p.bestApyEff === "number" ? p.bestApyEff : null))
      .filter((x): x is number => x != null && Number.isFinite(x) && x > 0)
      .sort((a,b) => a - b);

    const p10 = apysAll.length >= 5 ? percentile(apysAll, 0.10) : 1.5;  // ~1.5% baseline
    const p90 = apysAll.length >= 5 ? percentile(apysAll, 0.90) : 12;   // ~12% cap

    function yieldScoreFrom(apyEff: number | null): number | null {
      if (apyEff == null || !Number.isFinite(apyEff) || apyEff <= 0) return null;

      let z: number;
      if (p90 - p10 <= 1e-9) {
        // edge-case: clip op 12% en demp naar 0.2..0.8
        z = Math.max(0, Math.min(1, apyEff / 12));
      } else {
        z = (apyEff - p10) / (p90 - p10);
        z = Math.max(0, Math.min(1, z));
      }
      // demp: 0..1 → 0.2..0.8 (voorkomt 100%)
      return 0.2 + 0.6 * z;
    }

    // 7) Output
    const results = prelim.map((p, i) => {
      // Funding schalen rond 0 (cap ±0.05% = 0.0005)
      let fundingScore: number | null = null;
      if (typeof p.funding === "number" && Number.isFinite(p.funding)) {
        const capped = Math.max(-0.0005, Math.min(0.0005, p.funding));
        fundingScore = 0.5 + (capped / 0.0005) * 0.5; // -cap→0, +cap→1
      }

      // Yield-score + bearish-cap
      let yieldScore = yieldScoreFrom(p.bestApyEff);
      if (yieldScore != null) {
        const mom = typeof p.momentum === "number" ? p.momentum : 0.5;
        if (mom < 0.45) yieldScore = Math.min(yieldScore, 0.55);
      }

      // **OI demping**: 0..1 → 0.2..0.8, en bij bearish momentum cap 0.6
      let oiScore: number | null = (typeof p.oi === "number") ? p.oi : null;
      if (typeof oiScore === "number") {
        oiScore = 0.2 + 0.6 * Math.max(0, Math.min(1, oiScore));
        const mom = typeof p.momentum === "number" ? p.momentum : 0.5;
        if (mom < 0.45) oiScore = Math.min(oiScore, 0.6);
      }

      // ✅ LSR demping + crowding-penalty + bearish cap
      let lsrScore: number | null = (typeof p.lsr === "number") ? p.lsr : null;
      if (typeof lsrScore === "number") {
        // demp naar 0.2..0.8 rond 0.5 neutraal
        const centered = lsrScore - 0.5;         // -0.5..+0.5
        let s = 0.5 + centered * 0.6;            // 0.2..0.8

        // crowding-penalty: extreem veel longs (>0.65) of shorts (<0.35)
        if (lsrScore > 0.65) s -= (lsrScore - 0.65) * 1.0;
        if (lsrScore < 0.35) s += (0.35 - lsrScore) * 1.0;

        // hard-bounds
        s = Math.max(0.3, Math.min(0.7, s));

        // bearish context: cap maximaal 0.55
        const mom = typeof p.momentum === "number" ? p.momentum : 0.5;
        if (mom < 0.45) s = Math.min(s, 0.55);

        lsrScore = s;
      }

      // Performance: 24h (24×1h), 7d (168×1h), 30d (30×1d)
      const perf = {
        d: pctChangeFromCloses(p.closes1h, 24),
        w: pctChangeFromCloses(p.closes1h, 168),
        m: pctChangeFromCloses(p.closes1d, 30),
      };

      const breakdown: ComponentScoreNullable = {
        tvSignal: (typeof p.tv === "number") ? p.tv : null,
        momentum: (typeof p.momentum === "number") ? p.momentum : null,
        volatilityRegime: volRegScores[i],
        funding: fundingScore,
        openInterest: oiScore,
        longShortSkew: lsrScore,                 // ← gedempte LSR
        breadth,
        fearGreed: fearGreed,
        yield: yieldScore,
      };

      const score = combineScores(breakdown);

      const out: any = {
        symbol: p.coin.symbol,
        name: p.coin.name,
        slug: p.coin.slug || p.coin.santimentSlug || p.coin.symbol.toLowerCase(),
        status: score.status,
        score: score.total,
        breakdown: score.breakdown,
        perf,
        meta: {
          fng: fngVal,
          breadth: { green: greenCount, total: COINS.length, pct: breadth },
          pools: Array.isArray(p.pools) ? p.pools.slice(0, 3) : [],
          ...(DEBUG ? {
            __debug: {
              bestApyEff: p.bestApyEff,
              p10, p90,
              rawVol: p.rawVol,
              volRegScore: volRegScores[i],
              fundingRaw: p.funding,
              oiRaw: p.oi,
              oiScore,
              lsrRaw: p.lsr,
              lsrScore,
            }
          } : {})
        },
      };
      return out;
    });

    const payload: any = { updatedAt: Date.now(), results };
    setCache("SUMMARY", payload, 55_000);
    res.status(200).json(payload);
  } catch (e: any) {
    const payload = { updatedAt: Date.now(), results: [] as any[], __error: e?.message || String(e) };
    setCache("SUMMARY", payload, 10_000);
    res.status(200).json(payload);
  }
}