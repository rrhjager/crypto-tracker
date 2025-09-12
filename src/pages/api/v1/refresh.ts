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

// DeFiLlama voor yield
import { topPoolsForSymbol } from "@/lib/providers/defillama";

export const config = { maxDuration: 60 };

async function safe<T>(p: Promise<T>, fb: T): Promise<T> { try { return await p; } catch { return fb; } }

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────
function qbool(v: any): boolean {
  const s = String(v ?? "").toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}
function isFiniteNum(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store" as RequestCache });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function fetchKlinesFallback(symbol: string, interval: "1h" | "1d", limit: number, timeoutMs = 6000) {
  const hosts = ["https://api.binance.com","https://api1.binance.com","https://api2.binance.com","https://api3.binance.com","https://data-api.binance.vision"];
  const path = `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  for (const h of hosts) {
    try {
      const data = await fetchWithTimeout(h + path, {}, timeoutMs);
      if (Array.isArray(data) && data.length) {
        return data.map((row: any[]) => ({ close: Number(row?.[4]) })).filter(x => Number.isFinite(x.close));
      }
    } catch {}
  }
  return [];
}

async function fetchSpotPrice(symbol?: string | null, timeoutMs = 3500): Promise<{ price: number | null, src: string | null }> {
  if (!symbol) return { price: null, src: null };
  const hosts = ["https://api.binance.com","https://api1.binance.com","https://api2.binance.com","https://api3.binance.com","https://data-api.binance.vision"];
  // 1) ticker/price
  const path1 = `/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  for (const h of hosts) {
    try {
      const d = await fetchWithTimeout(h + path1, {}, timeoutMs);
      const p = Number(d?.price);
      if (Number.isFinite(p)) return { price: p, src: "ticker.price" };
    } catch {}
  }
  // 2) bookTicker mid
  const path2 = `/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`;
  for (const h of hosts) {
    try {
      const d = await fetchWithTimeout(h + path2, {}, timeoutMs);
      const bid = Number(d?.bidPrice), ask = Number(d?.askPrice);
      const mid = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : NaN;
      if (Number.isFinite(mid)) return { price: mid, src: "bookTicker.mid" };
    } catch {}
  }
  return { price: null, src: null };
}

// Futures symbol helpers
function toUsdtPerp(symbol?: string | null): string | null {
  if (!symbol) return null;
  let s = symbol.toUpperCase();
  if (s.startsWith("WETH")) s = "ETH" + s.slice(4);
  if (s.startsWith("WBTC")) s = "BTC" + s.slice(4);
  const stable = ["USDT","FDUSD","BUSD","USDC","TUSD","DAI","USD"];
  for (const st of stable) {
    if (s.endsWith(st)) { const base = s.slice(0, -st.length); return base + "USDT"; }
  }
  if (!s.endsWith("USDT")) s = s + "USDT";
  return s;
}
function toCoinMarginedPerp(symbol?: string | null): string | null {
  if (!symbol) return null;
  let s = symbol.toUpperCase();
  if (s.startsWith("WETH")) s = "ETH" + s.slice(4);
  if (s.startsWith("WBTC")) s = "BTC" + s.slice(4);
  const stable = ["USDT","FDUSD","BUSD","USDC","TUSD","DAI","USD"];
  let base = s;
  for (const st of stable) if (s.endsWith(st)) base = s.slice(0, -st.length);
  return base + "USD_PERP";
}

// ── Funding helpers (USDT-M, COIN-M + historisch)
async function fetchFundingUSDT(usdtPerp: string | null, timeoutMs = 4000): Promise<number | null> {
  if (!usdtPerp) return null;
  const hosts = ["https://fapi.binance.com","https://fapi1.binance.com","https://fapi2.binance.com","https://fapi3.binance.com"];
  const path = `/fapi/v1/premiumIndex?symbol=${encodeURIComponent(usdtPerp)}`;
  for (const h of hosts) {
    try {
      const d = await fetchWithTimeout(h + path, {}, timeoutMs);
      const r = Number(d?.lastFundingRate);
      if (Number.isFinite(r)) return r;
    } catch {}
  }
  return null;
}
async function fetchFundingCOIN(coinPerp: string | null, timeoutMs = 4000): Promise<number | null> {
  if (!coinPerp) return null;
  const hosts = ["https://dapi.binance.com","https://dapi1.binance.com","https://dapi2.binance.com","https://dapi3.binance.com"];
  const path = `/dapi/v1/premiumIndex?symbol=${encodeURIComponent(coinPerp)}`;
  for (const h of hosts) {
    try {
      const d = await fetchWithTimeout(h + path, {}, timeoutMs);
      const r = Number(d?.lastFundingRate);
      if (Number.isFinite(r)) return r;
    } catch {}
  }
  return null;
}
async function fetchFundingHistUSDT(usdtPerp: string | null, timeoutMs = 5000): Promise<number | null> {
  if (!usdtPerp) return null;
  const url = `https://www.binance.com/futures/data/fundingRate?symbol=${encodeURIComponent(usdtPerp)}&limit=1`;
  try {
    const arr = await fetchWithTimeout(url, {}, timeoutMs);
    if (Array.isArray(arr) && arr.length) {
      const r = Number(arr[arr.length - 1]?.fundingRate);
      if (Number.isFinite(r)) return r;
    }
  } catch {}
  return null;
}
async function fetchFundingHistCOIN(coinPerp: string | null, timeoutMs = 5000): Promise<number | null> {
  if (!coinPerp) return null;
  const url = `https://dapi.binance.com/dapi/v1/fundingRate?symbol=${encodeURIComponent(coinPerp)}&limit=1`;
  try {
    const arr = await fetchWithTimeout(url, {}, timeoutMs);
    if (Array.isArray(arr) && arr.length) {
      const r = Number(arr[arr.length - 1]?.fundingRate);
      if (Number.isFinite(r)) return r;
    }
  } catch {}
  return null;
}

// ── L/S skew helpers (normaliseer naar 0..1)
function normalizeLsrInput(v: any): number | null {
  if (isFiniteNum(v)) {
    if (v > 1) return Math.max(0, Math.min(1, v / (1 + v))); // ratio → 0..1
    if (v >= 0 && v <= 1) return v;
  }
  const asNum = Number(v);
  if (Number.isFinite(asNum)) {
    if (asNum > 1) return Math.max(0, Math.min(1, asNum / (1 + asNum)));
    if (asNum >= 0 && asNum <= 1) return asNum;
  }
  if (v && typeof v === "object") {
    const r = Number((v.longShortRatio ?? v.ratio ?? v.value));
    if (Number.isFinite(r)) {
      if (r > 1) return Math.max(0, Math.min(1, r / (1 + r)));
      if (r >= 0 && r <= 1) return r;
    }
    const L = Number(v.long ?? v.longs ?? v.longAccount);
    const S = Number(v.short ?? v.shorts ?? v.shortAccount);
    if (Number.isFinite(L) && Number.isFinite(S) && L + S > 0) {
      return Math.max(0, Math.min(1, L / (L + S)));
    }
  }
  return null;
}

async function fetchLSR_USDT(usdtPerp: string | null, timeoutMs = 4000): Promise<number | null> {
  if (!usdtPerp) return null;
  const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${encodeURIComponent(usdtPerp)}&period=5m&limit=1`;
  try {
    const arr = await fetchWithTimeout(url, {}, timeoutMs);
    if (Array.isArray(arr) && arr.length) {
      const last = arr[arr.length - 1];
      const ratio = Number(last?.longShortRatio); // >1 betekent meer longs
      if (Number.isFinite(ratio) && ratio > 0) {
        return Math.max(0, Math.min(1, ratio / (1 + ratio)));
      }
    }
  } catch {}
  return null;
}
async function fetchLSR_COIN(coinPerp: string | null, timeoutMs = 4000): Promise<number | null> {
  if (!coinPerp) return null;
  const url = `https://dapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${encodeURIComponent(coinPerp)}&period=5m&limit=1`;
  try {
    const arr = await fetchWithTimeout(url, {}, timeoutMs);
    if (Array.isArray(arr) && arr.length) {
      const last = arr[arr.length - 1];
      const ratio = Number(last?.longShortRatio);
      if (Number.isFinite(ratio) && ratio > 0) {
        return Math.max(0, Math.min(1, ratio / (1 + ratio)));
      }
    }
  } catch {}
  return null;
}

// ── OI helpers
async function fetchFuturesOpenInterestUSDT(usdtPerp: string | null, timeoutMs = 5000): Promise<number | null> {
  if (!usdtPerp) return null;
  const hosts = ["https://fapi.binance.com","https://fapi1.binance.com","https://fapi2.binance.com","https://fapi3.binance.com"];
  const path = `/fapi/v1/openInterest?symbol=${encodeURIComponent(usdtPerp)}`;
  for (const h of hosts) {
    try { const d = await fetchWithTimeout(h + path, {}, timeoutMs); const oi = Number(d?.openInterest); if (Number.isFinite(oi)) return oi; } catch {}
  }
  return null;
}
async function fetchOpenInterestHistUSDT(usdtPerp: string, timeoutMs = 6000): Promise<number | null> {
  const base = "https://www.binance.com";
  const path = `/futures/data/openInterestHist?symbol=${encodeURIComponent(usdtPerp)}&period=5m&limit=1`;
  try {
    const data = await fetchWithTimeout(base + path, {}, timeoutMs);
    if (Array.isArray(data) && data.length) {
      const last = data[data.length - 1];
      const usd = Number(last?.sumOpenInterestValue);
      const contracts = Number(last?.sumOpenInterest ?? last?.openInterest);
      if (Number.isFinite(usd)) return usd;
      if (Number.isFinite(contracts)) return contracts;
    }
  } catch {}
  return null;
}

// ── Yield helpers
const BASELINE_APY: Record<string, number> = {
  // conservatieve staking-achtige baselines (in %)
  ETH: 3.5, SOL: 6.0, BNB: 3.0, ADA: 3.0, AVAX: 6.0, MATIC: 2.5,
  NEAR: 7.0, DOT: 10.0, ATOM: 12.0, TRX: 4.0, XRP: 1.0, LTC: 0.8,
};

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

async function bestApyForSymbol(sym: string, fast: boolean): Promise<{ apyEff: number | null, src: "llama" | "baseline" | null, pools?: any[] }> {
  const SYM = sym.toUpperCase();
  // In FAST: sla externe call over, gebruik baseline als die bestaat
  if (fast) {
    if (BASELINE_APY[SYM] != null) return { apyEff: BASELINE_APY[SYM], src: "baseline" };
    return { apyEff: null, src: null };
  }

  // Niet-FAST: probeer DeFiLlama met kort budget; verlaag tvl-drempel & limit
  const pools = await safe(topPoolsForSymbol(SYM, { minTvlUsd: 1_000_000, maxPools: 4 }) as any, []);
  let best: number | null = null;
  for (const p of Array.isArray(pools) ? pools : []) {
    const apy = Number.isFinite(Number(p?.apy)) ? Number(p.apy)
      : Number(p?.apyBase || 0) + Number(p?.apyReward || 0);
    const tvl = Number(p?.tvlUsd || 0);
    if (!Number.isFinite(apy) || apy <= 0 || tvl < 1_000_000) continue;

    let qual = 1;
    if (p?.stablecoin === true) qual *= 0.85; // iets minder interessant
    if (hasIlRisk(p))         qual *= 0.70; // IL-penalty

    const eff = apy * qual;
    best = Math.max(best ?? 0, eff);
  }

  if (best != null && Number.isFinite(best) && best > 0) {
    return { apyEff: best, src: "llama", pools: pools.slice(0, 3) };
  }
  // fallback: baseline als beschikbaar
  if (BASELINE_APY[SYM] != null) {
    return { apyEff: BASELINE_APY[SYM], src: "baseline" };
  }
  return { apyEff: null, src: null };
}

// ── Maths
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
function minMaxNormalize(values: Array<number | null | undefined>): number[] {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!xs.length) return values.map(() => 0.5);
  const min = Math.min(...xs), max = Math.max(...xs);
  if (max - min < 1e-12) return values.map(() => 0.5);
  return values.map(v => (typeof v === "number" ? (v - min) / (max - min) : 0.5));
}
function pctChangeFromCloses(closes: number[], lookback: number): number {
  if (!Array.isArray(closes) || closes.length <= lookback) return 0;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - lookback];
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return 0;
  return ((last - prev) / prev) * 100;
}
function percentile(sortedAsc: number[], q: number): number {
  if (!sortedAsc.length) return 0;
  const i = Math.round(q * (sortedAsc.length - 1));
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, i))];
}

// ───────────────────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const DEBUG = qbool(req.query.debug);
    const FAST  = qbool(req.query.fast);

    // Timeouts/budgets
    const TIMEOUT = FAST ? 3500 : 8000;
    const KL_TIMEOUT = FAST ? 4000 : 8000;

    // 1) Market Fear & Greed
    const fng = await safe(getFearGreed(), { value: 50 } as any);
    const fngVal = Number((fng as any)?.value ?? 50);
    const fearGreed = 1 - Math.abs((fngVal / 100) - 0.5) * 2;

    // 2) Klines + snelle spotprijs
    const klinesByCoin = await Promise.all(
      COINS.map(async (coin) => {
        const symbol = coin.pairUSD?.binance;
        if (!symbol) return { coin, closes1h: [] as number[], closes1d: [] as number[], _livePrice: null as number | null, _priceSrc: null as string | null };

        let ks1h: any[] = await safe(fetchSpotKlines(symbol, "1h", 180) as any, []);
        let ks1d: any[] = await safe(fetchSpotKlines(symbol, "1d", 60) as any, []);

        // Fallbacks (korte timeouts)
        if (!Array.isArray(ks1h) || ks1h.length < 30) ks1h = await safe(fetchKlinesFallback(symbol, "1h", 180, KL_TIMEOUT), []);
        if (!Array.isArray(ks1d) || ks1d.length < 10) ks1d = await safe(fetchKlinesFallback(symbol, "1d", 60, KL_TIMEOUT), []);

        const closes1h = (ks1h as any[]).map(k => Number((k as any)?.close)).filter(Number.isFinite);
        const closes1d = (ks1d as any[]).map(k => Number((k as any)?.close)).filter(Number.isFinite);

        const live = await safe(fetchSpotPrice(symbol, TIMEOUT), { price: null, src: null });

        return { coin, closes1h, closes1d, _livePrice: live.price, _priceSrc: live.src };
      })
    );

    // 3) Indicatoren per coin
    type Pre = {
      coin: (typeof COINS)[number];
      closes1h: number[];
      closes1d: number[];
      tv: number | null;
      momentum: number | null;
      rawVol: number | null;
      funding: number | null;
      oi: number | null;          // USD indien beschikbaar
      lsr: number | null;
      pools: any[];
      bestApyEff: number | null;
      _yieldSrc?: "llama" | "baseline" | null;
      _futSym?: string | null;
      _coinPerp?: string | null;
      _oiSource?: string | null;
      _fundSrc?: string | null;
      _lsrSrc?: string | null;
      _livePrice?: number | null;
      _priceSrc?: string | null;
    };

    const prelim: Pre[] = await Promise.all(
      klinesByCoin.map(async ({ coin, closes1h, closes1d, _livePrice, _priceSrc }) => {
        const spotSym = coin.pairUSD?.binance;
        const futSym  = toUsdtPerp(spotSym);
        const coinPerp = toCoinMarginedPerp(spotSym);

        const momentum = closes1h.length ? momentumScoreFromCloses(closes1h) : null;
        const rawVol   = closes1h.length ? rawVolatilityFromCloses(closes1h, 72) : null;
        const tv       = await safe(tvSignalScore(spotSym), null);

        // Spotprijs voor OI→USD
        const approxPrice = (_livePrice ?? (closes1h.at(-1) ?? closes1d.at(-1) ?? null));

        // Open Interest (met hist fallback; contracten → USD)
        let _oiSource: string | null = null;
        let oi = await safe(currentOpenInterest(spotSym), null);
        if (isFiniteNum(oi)) {
          _oiSource = "provider";
        } else {
          oi = await safe(fetchFuturesOpenInterestUSDT(futSym, TIMEOUT), null);
          if (isFiniteNum(oi)) {
            _oiSource = "usdt-m";
          } else if (futSym) {
            oi = await safe(fetchOpenInterestHistUSDT(futSym, TIMEOUT + 1000), null);
            if (isFiniteNum(oi)) _oiSource = "hist-usdt";
          }
        }
        if ((_oiSource === "usdt-m" || _oiSource === "hist-usdt") && isFiniteNum(oi) && isFiniteNum(approxPrice)) {
          oi = oi * (approxPrice as number);
        }

        // Funding (USDT-M → COIN-M → hist → provider)
        let _fundSrc: string | null = null;
        let funding: number | null = null;

        const f1 = await safe(fetchFundingUSDT(futSym, TIMEOUT), null);
        if (isFiniteNum(f1)) { funding = f1; _fundSrc = "usdt-m"; }
        else {
          const f2 = await safe(fetchFundingCOIN(coinPerp, TIMEOUT), null);
          if (isFiniteNum(f2)) { funding = f2; _fundSrc = "coin-m"; }
          else {
            const f3 = await safe(fetchFundingHistUSDT(futSym, TIMEOUT + 1000), null);
            if (isFiniteNum(f3)) { funding = f3; _fundSrc = "hist-usdt"; }
            else {
              const f4 = await safe(fetchFundingHistCOIN(coinPerp, TIMEOUT + 1000), null);
              if (isFiniteNum(f4)) { funding = f4; _fundSrc = "hist-coin"; }
              else {
                const provNum = Number(await safe(latestFundingRate(spotSym), null));
                if (Number.isFinite(provNum)) { funding = provNum; _fundSrc = "provider"; }
                else { funding = null; _fundSrc = null; }
              }
            }
          }
        }

        // Long/Short skew — robuust + genormaliseerd (0..1)
        let _lsrSrc: string | null = null;
        let lsr: number | null = normalizeLsrInput(await safe(globalLongShortSkew(spotSym), null));
        if (isFiniteNum(lsr)) {
          _lsrSrc = "provider";
        } else {
          const u = await safe(fetchLSR_USDT(futSym, TIMEOUT), null);
          if (isFiniteNum(u)) { lsr = u; _lsrSrc = "usdt-m"; }
          else {
            const c = await safe(fetchLSR_COIN(coinPerp, TIMEOUT), null);
            if (isFiniteNum(c)) { lsr = c; _lsrSrc = "coin-m"; }
            else { lsr = null; _lsrSrc = null; }
          }
        }

        // Yield (altijd gevuld: llama → baseline)
        const y = await bestApyForSymbol(coin.symbol, FAST);
        const pools = !FAST && y.src === "llama" && Array.isArray(y.pools) ? y.pools : [];
        const bestApyEff = (y.apyEff != null && Number.isFinite(y.apyEff)) ? y.apyEff : null;

        return {
          coin, closes1h, closes1d, tv, momentum, rawVol, funding, oi, lsr,
          pools, bestApyEff, _yieldSrc: y.src ?? null,
          _futSym: futSym, _coinPerp: coinPerp, _oiSource, _fundSrc, _lsrSrc,
          _livePrice, _priceSrc
        };
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

    // 6) Yield percentielen (nu hebben we altijd data bij majors, baseline of llama)
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
      return 0.2 + 0.6 * z; // 0.2..0.8
    }

    // 6b) OI normaliseren (cross-sectioneel)
    const oiRaw = prelim.map(p => (typeof p.oi === "number" && Number.isFinite(p.oi)) ? p.oi : null);
    const oiFinite = oiRaw.filter((x): x is number => x != null);
    let oiNorm: number[] = oiRaw.map(() => 0.5);
    if (oiFinite.length >= 2) oiNorm = minMaxNormalize(oiRaw);
    else if (oiFinite.length === 1) {
      const idx = oiRaw.findIndex(v => typeof v === "number");
      oiNorm = oiRaw.map((_, i) => (i === idx ? 0.8 : 0.5));
    }

    // 7) Output
    const results = prelim.map((p, i) => {
      // Funding → score (cap ±0.05% per 8u)
      let fundingScore: number | null = null;
      if (isFiniteNum(p.funding)) {
        const capped = Math.max(-0.0005, Math.min(0.0005, p.funding as number));
        fundingScore = 0.5 + (capped / 0.0005) * 0.5;
      }

      // OI score (met demping)
      let oiScore: number | null = Number.isFinite(oiNorm[i]) ? oiNorm[i] : null;
      if (typeof oiScore === "number") {
        oiScore = 0.2 + 0.6 * Math.max(0, Math.min(1, oiScore));
        const mom = typeof p.momentum === "number" ? p.momentum : 0.5;
        if (mom < 0.45) oiScore = Math.min(oiScore, 0.6);
      }

      // L/S skew → score met crowding-penalty
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

      // Performance
      const perf = {
        d: pctChangeFromCloses(p.closes1h, 24),
        w: pctChangeFromCloses(p.closes1h, 168),
        m: pctChangeFromCloses(p.closes1d, 30),
      };

      // Prijs
      const last1h = p.closes1h.at(-1) ?? null;
      const last1d = p.closes1d.at(-1) ?? null;
      const price = (p._livePrice ?? (last1h ?? last1d ?? null));

      // Yield-score (altijd gevuld voor majors dankzij baseline)
      let yieldScore = yieldScoreFrom(p.bestApyEff);
      if (yieldScore != null) {
        const mom = typeof p.momentum === "number" ? p.momentum : 0.5;
        if (mom < 0.45) yieldScore = Math.min(yieldScore, 0.55);
      }

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
          ...(p._yieldSrc === "llama" ? { pools: Array.isArray(p.pools) ? p.pools.slice(0, 3) : [] } : {}),
          ...(DEBUG ? {
            __debug: {
              futSym: p._futSym,
              coinPerp: p._coinPerp,
              oiSource: p._oiSource,
              oiNorm: oiNorm[i],
              fundingSource: p._fundSrc ?? null,
              lsrSource: p._lsrSrc ?? null,
              yieldSource: p._yieldSrc ?? null,
              bestApyEff: p.bestApyEff ?? null,
              p10, p90,
              priceSource: p._priceSrc ?? (p._livePrice != null ? "ticker" : (last1h != null ? "kline-1h" : (last1d != null ? "kline-1d" : "none"))),
              livePrice: p._livePrice ?? null,
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