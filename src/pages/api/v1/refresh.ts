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

async function safe<T>(p: Promise<T>, fb: T): Promise<T> { try { return await p; } catch { return fb; } }

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store" as RequestCache });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Fallback rechtstreeks naar Binance hosts wanneer de provider niks/te weinig geeft
async function fetchKlinesFallback(symbol: string, interval: "1h" | "1d", limit: number) {
  const hosts = [
    "https://api.binance.com",
    "https://api1.binance.com",
    "https://api2.binance.com",
    "https://api3.binance.com",
    "https://data-api.binance.vision"
  ];
  const path = `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  for (const h of hosts) {
    try {
      const data = await fetchWithTimeout(h + path, {}, 8000);
      if (Array.isArray(data) && data.length) {
        // Binance klines: [openTime, open, high, low, close, ...]
        return data.map((row: any[]) => ({ close: Number(row?.[4]) })).filter(x => Number.isFinite(x.close));
      }
    } catch { /* probeer volgende host */ }
  }
  return [];
}

// ── OI: Futures helpers ────────────────────────────────────────────────────────

// Map spot symbols (…USDC/BUSD/FDUSD/… ) naar USDT-perp voor Futures
function toUsdtPerp(symbol?: string | null): string | null {
  if (!symbol) return null;
  let s = symbol.toUpperCase();
  // soms wrapped assets
  if (s.startsWith("WETH")) s = "ETH" + s.slice(4);
  if (s.startsWith("WBTC")) s = "BTC" + s.slice(4);

  const stable = ["USDT","FDUSD","BUSD","USDC","TUSD","DAI","USD"];
  for (const st of stable) {
    if (s.endsWith(st)) {
      const base = s.slice(0, -st.length);
      return base + "USDT";
    }
  }
  // geen suffix? gok USDT
  if (!s.endsWith("USDT")) s = s + "USDT";
  return s;
}

// Pak open interest (raw) direct van Binance Futures (USDT-M)
async function fetchFuturesOpenInterest(usdtPerp: string | null): Promise<number | null> {
  if (!usdtPerp) return null;
  const hosts = [
    "https://fapi.binance.com",
    "https://fapi1.binance.com",
    "https://fapi2.binance.com",
    "https://fapi3.binance.com",
  ];
  const path = `/fapi/v1/openInterest?symbol=${encodeURIComponent(usdtPerp)}`;
  for (const h of hosts) {
    try {
      const data = await fetchWithTimeout(h + path, {}, 8000);
      const oi = data ? Number(data.openInterest) : null; // in contracten, raw
      if (Number.isFinite(oi)) return oi;
    } catch { /* try next */ }
  }
  return null;
}

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

// Tolerant uitlezen van IL-risk op pools
function hasIlRisk(pool: any): boolean {
  const v =
    pool?.ilRisk ??
    pool?.il_risk ??
    pool?.impermanentLossRisk ??
    pool?.impermanent_loss_risk ??
    "";
  const s = String(v).toLowerCase().trim();
  return s === "yes" || s === "true" || s === "1" || s === "high";
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

        // Eerst de bestaande provider proberen
        let ks1h: any[] = await safe(fetchSpotKlines(symbol, "1h", 180) as any, []);
        let ks1d: any[] = await safe(fetchSpotKlines(symbol, "1d", 60) as any, []);

        // Fallback wanneer er (bijv. op Vercel) te weinig/geen data terugkomt
        if (!Array.isArray(ks1h) || ks1h.length < 30) {
          ks1h = await safe(fetchKlinesFallback(symbol, "1h", 180), []);
        }
        if (!Array.isArray(ks1d) || ks1d.length < 10) {
          ks1d = await safe(fetchKlinesFallback(symbol, "1d", 60), []);
        }

        const closes1h = (ks1h as any[]).map(k => Number((k as any)?.close)).filter(Number.isFinite);
        const closes1d = (ks1d as any[]).map(k => Number((k as any)?.close)).filter(Number.isFinite);
        return { coin, closes1h, closes1d };
      })
    );

    // 3) Lokale signalen + pools + OI (met futures fallback)
    type Pre = {
      coin: (typeof COINS)[number];
      closes1h: number[];
      closes1d: number[];
      tv: number | null;
      momentum: number | null;
      rawVol: number | null;
      funding: number | null;
      oi: number | null;   // raw OI (kan groot zijn)
      lsr: number | null;
      pools: any[];
      bestApyEff: number | null;
      _futSym?: string | null; // debug
    };

    const prelim: Pre[] = await Promise.all(
      klinesByCoin.map(async ({ coin, closes1h, closes1d }) => {
        const spotSym = coin.pairUSD?.binance;
        const futSym  = toUsdtPerp(spotSym);

        const momentum = closes1h.length ? momentumScoreFromCloses(closes1h) : null;
        const rawVol   = closes1h.length ? rawVolatilityFromCloses(closes1h, 72) : null;
        const tv       = await safe(tvSignalScore(spotSym), null);

        // Provider OI
        let oi = await safe(currentOpenInterest(spotSym), null);
        // Fallback naar Binance Futures (USDT-M) als provider niets geeft
        if (!(typeof oi === "number" && Number.isFinite(oi))) {
          oi = await safe(fetchFuturesOpenInterest(futSym), null);
        }

        const funding  = await safe(latestFundingRate(spotSym), null);
        const lsr      = await safe(globalLongShortSkew(spotSym), null);

        const pools    = await safe(topPoolsForSymbol(coin.symbol, { minTvlUsd: 3_000_000, maxPools: 6 }), []);

        // Beste APY per coin (robuust)
        let bestApyEff: number | null = null;
        for (const p of Array.isArray(pools) ? pools : []) {
          const apy = Number.isFinite(Number(p?.apy))
            ? Number(p.apy)
            : Number(p?.apyBase || 0) + Number(p?.apyReward || 0);

          const tvl = Number(p?.tvlUsd || 0);
          if (!Number.isFinite(apy) || apy <= 0 || tvl < 3_000_000) continue;

          let qual = 1;
          if (p?.stablecoin === true) qual *= 0.85;
          if (hasIlRisk(p)) qual *= 0.70;

          const eff = apy * qual;
          bestApyEff = Math.max(bestApyEff ?? 0, eff);
        }

        return { coin, closes1h, closes1d, tv, momentum, rawVol, funding, oi, lsr, pools, bestApyEff, _futSym: futSym };
      })
    );

    // 4) Breadth
    const momentumScores = prelim.map(p => (typeof p.momentum === "number" ? p.momentum : 0));
    const greenCount = momentumScores.filter(m => m >= 0.6).length;
    const breadth = COINS.length ? greenCount / COINS.length : 0.5;

    // 5) Volatility Regime
    const rawVols = prelim.map(p => p.rawVol);
    const volNorm01 = minMaxNormalize(rawVols);
    const volRegScores = volNorm01.map((v, i) => {
      let s = 1 - v;              // 0..1
      s = 0.3 + 0.4 * s;          // 0.3..0.7
      const mom = typeof prelim[i].momentum === "number" ? prelim[i].momentum : 0.5;
      if (mom < 0.45) s = Math.min(s, 0.6);
      return s;
    });

    // 6) Yield percentielen
    const apysAll = prelim
      .map(p => (typeof p.bestApyEff === "number" ? p.bestApyEff : null))
      .filter((x): x is number => x != null && Number.isFinite(x) && x > 0)
      .sort((a, b) => a - b);

    const p10 = apysAll.length >= 5 ? percentile(apysAll, 0.10) : 1.5;
    const p90 = apysAll.length >= 5 ? percentile(apysAll, 0.90) : 12;

    function yieldScoreFrom(apyEff: number | null): number | null {
      if (apyEff == null || !Number.isFinite(apyEff) || apyEff <= 0) return null;

      let z: number;
      if (p90 - p10 <= 1e-9) {
        z = Math.max(0, Math.min(1, apyEff / 12));
      } else {
        z = (apyEff - p10) / (p90 - p10);
        z = Math.max(0, Math.min(1, z));
      }
      return 0.2 + 0.6 * z;
    }

    // 6b) OI normaliseren cross-sectioneel (voorkom “alles 0.5”)
    const oiRaw = prelim.map(p => (typeof p.oi === "number" && Number.isFinite(p.oi)) ? p.oi : null);
    const oiFinite = oiRaw.filter((x): x is number => x != null);
    let oiNorm: number[] = oiRaw.map(() => 0.5); // default 0.5

    if (oiFinite.length >= 2) {
      oiNorm = minMaxNormalize(oiRaw);
    } else if (oiFinite.length === 1) {
      // slechts één coin heeft OI → geef die zichtbaar gewicht (0.8), rest 0.5
      const idx = oiRaw.findIndex(v => typeof v === "number");
      oiNorm = oiRaw.map((_, i) => (i === idx ? 0.8 : 0.5));
    }
    // (0 → laagste OI, 1 → hoogste OI in deze batch)

    // 7) Output
    const results = prelim.map((p, i) => {
      // Funding rond 0 (cap ±0.05% = 0.0005)
      let fundingScore: number | null = null;
      if (typeof p.funding === "number" && Number.isFinite(p.funding)) {
        const capped = Math.max(-0.0005, Math.min(0.0005, p.funding));
        fundingScore = 0.5 + (capped / 0.0005) * 0.5;
      }

      // Yield-score + bearish-cap
      let yieldScore = yieldScoreFrom(p.bestApyEff);
      if (yieldScore != null) {
        const mom = typeof p.momentum === "number" ? p.momentum : 0.5;
        if (mom < 0.45) yieldScore = Math.min(yieldScore, 0.55);
      }

      // OI demping (gebruik **genormaliseerde** OI)
      let oiScore: number | null = Number.isFinite(oiNorm[i]) ? oiNorm[i] : null;
      if (typeof oiScore === "number") {
        oiScore = 0.2 + 0.6 * Math.max(0, Math.min(1, oiScore));
        const mom = typeof p.momentum === "number" ? p.momentum : 0.5;
        if (mom < 0.45) oiScore = Math.min(oiScore, 0.6);
      }

      // LSR demping + crowding-penalty (ongewijzigd)
      let lsrScore: number | null = (typeof p.lsr === "number") ? p.lsr : null;
      if (typeof lsrScore === "number") {
        const centered = lsrScore - 0.5;
        let s = 0.5 + centered * 0.6;
        if (lsrScore > 0.65) s -= (lsrScore - 0.65) * 1.0;
        if (lsrScore < 0.35) s += (0.35 - lsrScore) * 1.0;
        s = Math.max(0.3, Math.min(0.7, s));
        const mom = typeof p.momentum === "number" ? p.momentum : 0.5;
        if (mom < 0.45) s = Math.min(s, 0.55);
        lsrScore = s;
      }

      // Performance: 24h, 7d, 30d
      const perf = {
        d: pctChangeFromCloses(p.closes1h, 24),
        w: pctChangeFromCloses(p.closes1h, 168),
        m: pctChangeFromCloses(p.closes1d, 30),
      };

      // Laatste prijs (voor kolom "Prijs" in UI)
      const last1h = p.closes1h.length ? p.closes1h[p.closes1h.length - 1] : null;
      const last1d = p.closes1d.length ? p.closes1d[p.closes1d.length - 1] : null;
      const price = (last1h ?? last1d ?? null);

      // Breakdown
      const breakdown = ({
        tvSignal: (typeof p.tv === "number") ? p.tv : null,
        momentum: (typeof p.momentum === "number") ? p.momentum : null,
        volatilityRegime: volRegScores[i],
        funding: fundingScore,
        openInterest: oiScore,
        longShortSkew: lsrScore,
        breadth,
        fearGreed: fearGreed,
        yield: yieldScore,
      } as unknown) as ComponentScoreNullable;

      const score = combineScores(breakdown);

      const out: any = {
        symbol: p.coin.symbol,
        name: p.coin.name,
        slug: p.coin.slug || p.coin.santimentSlug || p.coin.symbol.toLowerCase(),
        status: score.status,
        score: score.total,
        breakdown: score.breakdown,
        price,
        perf,
        meta: {
          fng: fngVal,
          breadth: { green: greenCount, total: COINS.length, pct: breadth },
          pools: Array.isArray(p.pools) ? p.pools.slice(0, 3) : [],
          ...(DEBUG ? {
            __debug: {
              futSym: p._futSym,
              oiRaw: p.oi,
              oiNorm: oiNorm[i],
              momentum: p.momentum,
              closes1hLen: p.closes1h.length,
              closes1dLen: p.closes1d.length,
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