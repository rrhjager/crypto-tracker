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

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = 7000) {
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

// Klein concurrency-limiet voor per-symbol fallbacks
function pLimit(n: number) {
  let active = 0; const q: Array<() => void> = [];
  const next = () => { active--; q.shift()?.(); };
  return <T>(fn: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    const run = () => { active++; fn().then((v)=>{resolve(v); next();}).catch((e)=>{reject(e); next();}); };
    active < n ? run() : q.push(run);
  });
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
      const data = await fetchWithTimeout(h + path, {}, 7000);
      if (Array.isArray(data) && data.length) {
        return data.map((row: any[]) => ({ close: Number(row?.[4]) })).filter(x => Number.isFinite(x.close));
      }
    } catch { /* try next host */ }
  }
  return [];
}

// ── Live spot prices (nieuw) ───────────────────────────────────────────────────

// 1) Probeer bulk: één call die ALLE spot-prijzen geeft; filter daarna op onze symbols.
async function fetchAllSpotPricesBulk(symbolsWanted: string[]): Promise<Record<string, number>> {
  const hosts = [
    "https://api.binance.com",
    "https://api1.binance.com",
    "https://api2.binance.com",
    "https://api3.binance.com",
    "https://data-api.binance.vision"
  ];
  const path = `/api/v3/ticker/price`; // alle symbols
  for (const h of hosts) {
    try {
      const data = await fetchWithTimeout(h + path, {}, 5000);
      if (Array.isArray(data)) {
        const setWanted = new Set(symbolsWanted.map(s => s?.toUpperCase()).filter(Boolean));
        const out: Record<string, number> = {};
        for (const item of data) {
          const sym = String(item?.symbol || "").toUpperCase();
          if (setWanted.has(sym)) {
            const px = Number(item?.price);
            if (Number.isFinite(px)) out[sym] = px;
          }
        }
        if (Object.keys(out).length) return out;
      }
    } catch { /* next host */ }
  }
  return {};
}

// 2) Per-symbol fallback voor ontbrekende symbols
async function fetchSpotPriceSingle(symbol: string): Promise<number | null> {
  const hosts = [
    "https://api.binance.com",
    "https://api1.binance.com",
    "https://api2.binance.com",
    "https://api3.binance.com",
    "https://data-api.binance.vision"
  ];
  const path = `/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  for (const h of hosts) {
    try {
      const data = await fetchWithTimeout(h + path, {}, 4000);
      const px = Number((data as any)?.price);
      if (Number.isFinite(px)) return px;
    } catch { /* next host */ }
  }
  return null;
}

// 3) Mark price fallback (USDT-M) — handig als een spot-pair even geen ticker oplevert
async function fetchFuturesMarkPrice(usdtPerp: string | null): Promise<number | null> {
  if (!usdtPerp) return null;
  const hosts = ["https://fapi.binance.com","https://fapi1.binance.com","https://fapi2.binance.com","https://fapi3.binance.com"];
  const path = `/fapi/v1/premiumIndex?symbol=${encodeURIComponent(usdtPerp)}`;
  for (const h of hosts) {
    try {
      const data = await fetchWithTimeout(h + path, {}, 4000);
      const px = Number((data as any)?.markPrice);
      if (Number.isFinite(px)) return px;
    } catch { /* next */ }
  }
  return null;
}

// Map spot symbols (…USDC/BUSD/FDUSD/… ) naar USDT-perp voor USDT-M Futures
function toUsdtPerp(symbol?: string | null): string | null {
  if (!symbol) return null;
  let s = symbol.toUpperCase();
  if (s.startsWith("WETH")) s = "ETH" + s.slice(4);
  if (s.startsWith("WBTC")) s = "BTC" + s.slice(4);
  const stable = ["USDT","FDUSD","BUSD","USDC","TUSD","DAI","USD"];
  for (const st of stable) {
    if (s.endsWith(st)) {
      const base = s.slice(0, -st.length);
      return base + "USDT";
    }
  }
  if (!s.endsWith("USDT")) s = s + "USDT";
  return s;
}

// Bouw één prijs-map voor alle coins: bulk → per-symbol → mark price
async function buildLivePriceMap(symbols: string[]): Promise<Record<string, number>> {
  const wanted = symbols.filter(Boolean).map(s => s.toUpperCase());
  const out: Record<string, number> = {};

  // bulk
  const bulk = await fetchAllSpotPricesBulk(wanted);
  Object.assign(out, bulk);

  // per-symbol voor missers
  const missing = wanted.filter(s => out[s] == null);
  if (missing.length) {
    const limit = pLimit(8);
    const singles = await Promise.all(missing.map(sym => limit(() => fetchSpotPriceSingle(sym))));
    singles.forEach((px, i) => {
      const sym = missing[i];
      if (Number.isFinite(px as any)) out[sym] = px as number;
    });
  }

  // mark price fallback
  const stillMissing = wanted.filter(s => out[s] == null);
  if (stillMissing.length) {
    const limit = pLimit(8);
    const futs = await Promise.all(stillMissing.map(sym => {
      const usdtPerp = toUsdtPerp(sym);
      return limit(() => fetchFuturesMarkPrice(usdtPerp));
    }));
    futs.forEach((px, i) => {
      const sym = stillMissing[i];
      if (Number.isFinite(px as any)) out[sym] = px as number;
    });
  }

  return out;
}

// ── OI: Futures helpers ────────────────────────────────────────────────────────

// Map naar COIN-M perpetual (BASEUSD_PERP)
function toCoinMarginedPerp(symbol?: string | null): string | null {
  if (!symbol) return null;
  let s = symbol.toUpperCase();
  if (s.startsWith("WETH")) s = "ETH" + s.slice(4);
  if (s.startsWith("WBTC")) s = "BTC" + s.slice(4);
  const stable = ["USDT","FDUSD","BUSD","USDC","TUSD","DAI","USD"];
  let base = s;
  for (const st of stable) {
    if (s.endsWith(st)) base = s.slice(0, -st.length);
  }
  return base + "USD_PERP";
}

// OI van USDT-M (contracts)
async function fetchFuturesOpenInterestUSDT(usdtPerp: string | null): Promise<number | null> {
  if (!usdtPerp) return null;
  const hosts = ["https://fapi.binance.com","https://fapi1.binance.com","https://fapi2.binance.com","https://fapi3.binance.com"];
  const path = `/fapi/v1/openInterest?symbol=${encodeURIComponent(usdtPerp)}`;
  for (const h of hosts) {
    try {
      const data = await fetchWithTimeout(h + path, {}, 6000);
      const oi = data ? Number((data as any).openInterest) : null;
      if (Number.isFinite(oi)) return oi;
    } catch { /* next host */ }
  }
  return null;
}

// OI van COIN-M (contracts)
async function fetchFuturesOpenInterestCOIN(coinPerp: string | null): Promise<number | null> {
  if (!coinPerp) return null;
  const hosts = ["https://dapi.binance.com","https://dapi1.binance.com","https://dapi2.binance.com","https://dapi3.binance.com"];
  const path = `/dapi/v1/openInterest?symbol=${encodeURIComponent(coinPerp)}`;
  for (const h of hosts) {
    try {
      const data = await fetchWithTimeout(h + path, {}, 6000);
      const oi = data ? Number((data as any).openInterest) : null;
      if (Number.isFinite(oi)) return oi;
    } catch { /* next host */ }
  }
  return null;
}

// Laatste redmiddel voor OI
async function fetchOpenInterestHist(symbol: string): Promise<number | null> {
  const base = "https://www.binance.com";
  const path = `/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=5m&limit=1`;
  try {
    const data = await fetchWithTimeout(base + path, {}, 6000);
    if (Array.isArray(data) && data.length) {
      const last = data[data.length - 1];
      const oi = Number(last?.sumOpenInterest ?? last?.openInterest ?? last?.sumOpenInterestValue);
      return Number.isFinite(oi) ? oi : null;
    }
  } catch {}
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
  const s = String(
    pool?.ilRisk ?? pool?.il_risk ?? pool?.impermanentLossRisk ?? pool?.impermanent_loss_risk ?? ""
  ).toLowerCase().trim();
  return s === "yes" || s === "true" || s === "1" || s === "high";
}

// ───────────────────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const q = String(req.query.debug || "").toLowerCase();
    const DEBUG = q === "1" || q === "true";

    // ⚡ Haal live spot-prijzen alvast in parallel op
    const spotSymbols = COINS.map(c => c.pairUSD?.binance).filter(Boolean) as string[];
    const livePriceMapPromise = buildLivePriceMap(spotSymbols);

    // 1) Market Fear & Greed (0..1)
    const fng = await safe(getFearGreed(), { value: 50 } as any);
    const fngVal = Number((fng as any)?.value ?? 50);
    const fearGreed = 1 - Math.abs((fngVal / 100) - 0.5) * 2;

    // 2) Klines (nog steeds nodig voor momentum/perf, maar prijs komt nu live)
    const klinesByCoin = await Promise.all(
      COINS.map(async (coin) => {
        const symbol = coin.pairUSD?.binance;
        if (!symbol) return { coin, closes1h: [] as number[], closes1d: [] as number[] };

        let ks1h: any[] = await safe(fetchSpotKlines(symbol, "1h", 180) as any, []);
        let ks1d: any[] = await safe(fetchSpotKlines(symbol, "1d", 60) as any, []);

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

    // 3) Lokale signalen + pools + OI
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
      bestApyEff: number | null;
      _futSym?: string | null;
      _coinPerp?: string | null;
      _oiSource?: "provider" | "usdt-m" | "coin-m" | "hist-usdt" | "hist-coin" | null;
    };

    const prelim: Pre[] = await Promise.all(
      klinesByCoin.map(async ({ coin, closes1h, closes1d }) => {
        const spotSym = coin.pairUSD?.binance;
        const futSym  = toUsdtPerp(spotSym);
        const coinPerp = toCoinMarginedPerp(spotSym);

        const momentum = closes1h.length ? momentumScoreFromCloses(closes1h) : null;
        const rawVol   = closes1h.length ? rawVolatilityFromCloses(closes1h, 72) : null;
        const tv       = await safe(tvSignalScore(spotSym), null);

        let _oiSource: Pre["_oiSource"] = null;

        // OI
        let oi = await safe(currentOpenInterest(spotSym), null);
        if (typeof oi === "number" && Number.isFinite(oi)) {
          _oiSource = "provider";
        } else {
          oi = await safe(fetchFuturesOpenInterestUSDT(futSym), null);
          if (typeof oi === "number" && Number.isFinite(oi)) {
            _oiSource = "usdt-m";
          } else {
            oi = await safe(fetchFuturesOpenInterestCOIN(coinPerp), null);
            if (typeof oi === "number" && Number.isFinite(oi)) {
              _oiSource = "coin-m";
            } else {
              const histSym = futSym ?? coinPerp ?? "";
              if (histSym) {
                const histOi = await safe(fetchOpenInterestHist(histSym), null);
                if (typeof histOi === "number" && Number.isFinite(histOi)) {
                  oi = histOi; _oiSource = histSym === futSym ? "hist-usdt" : "hist-coin";
                }
              }
            }
          }
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

        return { coin, closes1h, closes1d, tv, momentum, rawVol, funding, oi, lsr, pools, bestApyEff, _futSym: futSym, _coinPerp: coinPerp, _oiSource };
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
      let s = 1 - v; s = 0.3 + 0.4 * s;
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
      if (p90 - p10 <= 1e-9) z = Math.max(0, Math.min(1, apyEff / 12));
      else { z = (apyEff - p10) / (p90 - p10); z = Math.max(0, Math.min(1, z)); }
      return 0.2 + 0.6 * z;
    }

    // 6b) OI normaliseren cross-sectioneel
    const oiRaw = prelim.map(p => (typeof p.oi === "number" && Number.isFinite(p.oi)) ? p.oi : null);
    const oiFinite = oiRaw.filter((x): x is number => x != null);
    let oiNorm: number[] = oiRaw.map(() => 0.5);
    if (oiFinite.length >= 2) oiNorm = minMaxNormalize(oiRaw);
    else if (oiFinite.length === 1) {
      const idx = oiRaw.findIndex(v => typeof v === "number");
      oiNorm = oiRaw.map((_, i) => (i === idx ? 0.8 : 0.5));
    }

    // ✅ Wacht één keer op de live prijs-map (is al even aan het lopen)
    const livePriceMap = await safe(livePriceMapPromise, {} as Record<string, number>);

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

      // OI demping (genormaliseerde OI)
      let oiScore: number | null = Number.isFinite(oiNorm[i]) ? oiNorm[i] : null;
      if (typeof oiScore === "number") {
        oiScore = 0.2 + 0.6 * Math.max(0, Math.min(1, oiScore));
        const mom = typeof p.momentum === "number" ? p.momentum : 0.5;
        if (mom < 0.45) oiScore = Math.min(oiScore, 0.6);
      }

      // LSR demping + crowding-penalty
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

      // Laatste prijs (live → anders laatste close)
      const spotSym = p.coin.pairUSD?.binance?.toUpperCase() || "";
      const livePrice = livePriceMap[spotSym];
      const last1h = p.closes1h.length ? p.closes1h[p.closes1h.length - 1] : null;
      const last1d = p.closes1d.length ? p.closes1d[p.closes1d.length - 1] : null;
      const price: number | null = (Number.isFinite(livePrice) ? livePrice : null) ?? last1h ?? last1d;

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
              livePrice,
              futSym: toUsdtPerp(spotSym),
              coinPerp: toCoinMarginedPerp(spotSym),
              oiSource: (prelim[i] as any)._oiSource,
              oiRaw: prelim[i].oi,
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