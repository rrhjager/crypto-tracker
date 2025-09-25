// src/pages/api/v1/refresh.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { COINS } from "@/lib/coins";
import { setCache } from "@/lib/cache";

import { fetchSpotKlines } from "@/lib/providers/binance";
import { latestFundingRate, currentOpenInterest, globalLongShortSkew } from "@/lib/providers/binanceFutures";
import { momentumScoreFromCloses } from "@/lib/indicators/momentum";
import { combineScores, ComponentScoreNullable } from "@/lib/scoring";
import { getFearGreed } from "@/lib/providers/fng";

// Alleen gebruiken in deep mode (fast=0)
import { topPoolsForSymbol } from "@/lib/providers/defillama";

// ➕ Concurrency limiter (NIEUW)
import pLimit from "p-limit";
const limit = pLimit(6); // 6 tegelijk is meestal safe

export const config = { maxDuration: 60 };

async function safe<T>(p: Promise<T>, fb: T): Promise<T> { try { return await p; } catch { return fb; } }
function qbool(v: any): boolean { const s = String(v ?? "").toLowerCase(); return s==="1"||s==="true"||s==="yes"||s==="y"; }
function isNum(x:any): x is number { return typeof x==="number" && Number.isFinite(x); }

// ───────────────────────────────────────────────
// Generic helpers
// ───────────────────────────────────────────────
async function j(url: string, opts: RequestInit = {}, ms = 4000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { ...opts, signal: c.signal, cache: "no-store" as RequestCache }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}

<<<<<<< HEAD
// Fallback rechtstreeks naar Binance hosts wanneer de provider niks/te weinig geeft
async function fetchKlinesFallback(symbol: string, interval: "1h" | "1d", limitN: number) {
  const hosts = [
    "https://api.binance.com",
    "https://api1.binance.com",
    "https://api2.binance.com",
    "https://api3.binance.com",
    "https://data-api.binance.vision"
  ];
  const path = `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limitN}`;
=======
function limitConcurrency<T, R>(items: T[], limit: number, worker: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  return new Promise((resolve) => {
    const out: R[] = new Array(items.length);
    let i = 0, running = 0, done = 0;
    const kick = () => {
      while (running < limit && i < items.length) {
        const idx = i++, item = items[idx];
        running++;
        worker(item, idx).then(
          (res) => { out[idx] = res; },
          () => { /* ignore, hole filled below */ }
        ).finally(() => {
          running--; done++;
          if (done === items.length) resolve(out);
          else kick();
        });
      }
    };
    if (items.length === 0) resolve([]);
    kick();
  });
}

// ───────────────────────────────────────────────
// Binance spot fallbacks
// ───────────────────────────────────────────────
async function klinesFallback(symbol: string, interval: "1h" | "1d", limit: number, ms = 4000) {
  const hosts = ["https://api1.binance.com","https://api2.binance.com","https://api3.binance.com","https://api.binance.com","https://data-api.binance.vision"];
  const path = `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
>>>>>>> b451e384412f3d17c2aa1a5d1c295221c8855695
  for (const h of hosts) {
    try {
      const data = await j(h + path, {}, ms);
      if (Array.isArray(data) && data.length) {
        return data.map((row: any[]) => ({ close: Number(row?.[4]) })).filter(x => Number.isFinite(x.close));
      }
    } catch {}
  }
  return [];
}

async function spotPrice(symbol?: string | null, ms = 2500): Promise<number|null> {
  if (!symbol) return null;
  const hosts = ["https://api1.binance.com","https://api2.binance.com","https://api3.binance.com","https://api.binance.com"];
  const p1 = `/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  for (const h of hosts) { try { const d = await j(h+p1,{},ms); const p = Number(d?.price); if (Number.isFinite(p)) return p; } catch {} }
  const p2 = `/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`;
  for (const h of hosts) { try { const d = await j(h+p2,{},ms); const bid=Number(d?.bidPrice), ask=Number(d?.askPrice); const mid=(bid+ask)/2; if (Number.isFinite(mid)) return mid; } catch {} }
  return null;
}

// ───────────────────────────────────────────────
// Futures symbols & metrics (funding / OI / LSR)
// ───────────────────────────────────────────────
function toUsdtPerp(symbol?: string | null): string | null {
  if (!symbol) return null;
  let s = symbol.toUpperCase();
  if (s.startsWith("WETH")) s = "ETH" + s.slice(4);
  if (s.startsWith("WBTC")) s = "BTC" + s.slice(4);
  const stables = ["USDT","FDUSD","BUSD","USDC","TUSD","DAI","USD"];
  for (const st of stables) if (s.endsWith(st)) return s.slice(0, -st.length) + "USDT";
  if (!s.endsWith("USDT")) s += "USDT";
  return s;
}
function toCoinPerp(symbol?: string | null): string | null {
  if (!symbol) return null;
  let s = symbol.toUpperCase();
  if (s.startsWith("WETH")) s = "ETH" + s.slice(4);
  if (s.startsWith("WBTC")) s = "BTC" + s.slice(4);
  const stables = ["USDT","FDUSD","BUSD","USDC","TUSD","DAI","USD"];
  let base = s; for (const st of stables) if (s.endsWith(st)) base = s.slice(0, -st.length);
  return base + "USD_PERP";
}

async function fundingUSDT(sym: string|null, ms=3000) {
  if (!sym) return null;
  const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(sym)}`;
  try { const d = await j(url, {}, ms); const r = Number(d?.lastFundingRate); return Number.isFinite(r) ? r : null; } catch { return null; }
}
async function fundingUSDT_hist(sym:string|null, ms=3500) {
  if (!sym) return null;
  const url = `https://www.binance.com/futures/data/fundingRate?symbol=${encodeURIComponent(sym)}&limit=1`;
  try { const a = await j(url, {}, ms); const r = Number(a?.[a.length-1]?.fundingRate); return Number.isFinite(r)?r:null; } catch { return null; }
}

async function oiUSDT(sym: string|null, ms=3500) {
  if (!sym) return null;
  const url = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(sym)}`;
  try { const d = await j(url, {}, ms); const x = Number(d?.openInterest); return Number.isFinite(x)?x:null; } catch { return null; }
}
async function oiUSDT_hist(sym:string|null, ms=4000) {
  if (!sym) return null;
  const url = `https://www.binance.com/futures/data/openInterestHist?symbol=${encodeURIComponent(sym)}&period=5m&limit=1`;
  try { const a = await j(url, {}, ms); const last=a?.[a.length-1]; const usd=Number(last?.sumOpenInterestValue); const c=Number(last?.sumOpenInterest??last?.openInterest); return Number.isFinite(usd)?usd:(Number.isFinite(c)?c:null); } catch { return null; }
}

async function lsrUSDT(sym:string|null, ms=3000) {
  if (!sym) return null;
  const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${encodeURIComponent(sym)}&period=5m&limit=1`;
  try { const a = await j(url, {}, ms); const r = Number(a?.[a.length-1]?.longShortRatio); return Number.isFinite(r)&&r>0 ? (r/(1+r)) : null; } catch { return null; }
}

function normalizeLsrInput(v: any): number | null {
  if (isNum(v)) { if (v > 1) return v/(1+v); if (v >= 0 && v <= 1) return v; }
  const n = Number(v); if (Number.isFinite(n)) { if (n>1) return n/(1+n); if (n>=0 && n<=1) return n; }
  if (v && typeof v === "object") {
    const r = Number(v.longShortRatio ?? v.ratio ?? v.value);
    if (Number.isFinite(r)) return r>1 ? r/(1+r) : (r>=0 && r<=1 ? r : null);
    const L = Number(v.long ?? v.longs ?? v.longAccount), S = Number(v.short ?? v.shorts ?? v.shortAccount);
    if (Number.isFinite(L) && Number.isFinite(S) && L+S>0) return L/(L+S);
  }
  return null;
}

// ───────────────────────────────────────────────
// Maths
// ───────────────────────────────────────────────
function rawVol(closes:number[], n=72) {
  const m = Math.min(n, closes.length-1); if (m<=5) return null;
  const start = closes.length-1-m; const rets:number[]=[];
  for (let i=start+1;i<=start+m;i++){ const p0=closes[i-1], p1=closes[i]; if (p0>0&&p1>0) rets.push(Math.log(p1/p0)); }
  if (rets.length<5) return null;
  const mean = rets.reduce((a,b)=>a+b,0)/rets.length;
  const varc = rets.reduce((a,b)=>a+(b-mean)**2,0)/(rets.length-1);
  const sd = Math.sqrt(Math.max(varc,0));
  return Number.isFinite(sd)?sd:null;
}
function minmax(vals:(number|null)[]) {
  const xs = vals.filter((v):v is number => typeof v==="number"&&Number.isFinite(v));
  if (!xs.length) return vals.map(()=>0.5);
  const mn=Math.min(...xs), mx=Math.max(...xs); if (mx-mn<1e-12) return vals.map(()=>0.5);
  return vals.map(v => (typeof v==="number" ? (v-mn)/(mx-mn) : 0.5));
}
function pctChange(cl:number[], lookback:number) {
  if (!cl.length || cl.length<=lookback) return 0;
  const a = cl[cl.length-1], b = cl[cl.length-1-lookback]; if (!Number.isFinite(a)||!Number.isFinite(b)||b===0) return 0;
  return ((a-b)/b)*100;
}
function percentile(sortedAsc:number[], q:number){ if(!sortedAsc.length) return 0; const i=Math.round(q*(sortedAsc.length-1)); return sortedAsc[Math.min(sortedAsc.length-1,Math.max(0,i))]; }

// ───────────────────────────────────────────────
// Baseline yields (altijd beschikbaar, geen externe call)
// ───────────────────────────────────────────────
const BASELINE_APY_DEFAULT = 2.0;
const BASELINE_APY: Record<string, number> = {
  ETH: 3.5, SOL: 6.0, BNB: 3.0, ADA: 3.0, AVAX: 6.0, MATIC: 2.5,
  NEAR: 7.0, DOT: 10.0, ATOM: 12.0, TRX: 4.0, XRP: 1.0, LTC: 0.8,
};

// ───────────────────────────────────────────────
// Handler
// ───────────────────────────────────────────────
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const DEBUG = qbool(req.query.debug);
    // Default FAST = true (snel pad bij cold start / cron kan fast=0 doen)
    const FAST  = req.query.fast !== undefined ? qbool(req.query.fast) : true;

    // Tijd-budgetten en concurrency-caps
    const TIME = FAST ? 3200 : 8000;
    const KLT  = FAST ? 3600 : 7000;
    const CONC = FAST ? 6 : 8;

<<<<<<< HEAD
    // 2) Klines + snelle spotprijs (GEDOSEERD met p-limit)
    const klinesByCoin = await Promise.all(
      COINS.map((coin) => limit(async () => {
        const symbol = coin.pairUSD?.binance;
        if (!symbol) return { coin, closes1h: [] as number[], closes1d: [] as number[], _livePrice: null as number | null, _priceSrc: null as string | null };
=======
    // 0) Macro
    const fng  = await safe(getFearGreed(), { value: 50 } as any);
    const fngV = Number((fng as any)?.value ?? 50);
    const fearGreed = 1 - Math.abs((fngV/100) - 0.5) * 2;
>>>>>>> b451e384412f3d17c2aa1a5d1c295221c8855695

    // 1) Klines + snelle spotprijs (gelimiteerde concurrency)
    const klInputs = COINS.map(c => c);
    const klinesByCoin = await limitConcurrency(klInputs, CONC, async (coin) => {
      const sym = coin.pairUSD?.binance;
      if (!sym) return { coin, closes1h: [] as number[], closes1d: [] as number[], price: null as number|null, _priceSrc: null as string|null };

      let k1h:any[] = await safe(fetchSpotKlines(sym, "1h", 120) as any, []);
      let k1d:any[] = await safe(fetchSpotKlines(sym, "1d", 45) as any, []);
      if (!Array.isArray(k1h) || k1h.length < 24) k1h = await safe(klinesFallback(sym, "1h", 120, KLT), []);
      if (!Array.isArray(k1d) || k1d.length < 15) k1d = await safe(klinesFallback(sym, "1d", 45, KLT), []);

      const closes1h = (k1h as any[]).map(k => Number((k as any)?.close)).filter(Number.isFinite);
      const closes1d = (k1d as any[]).map(k => Number((k as any)?.close)).filter(Number.isFinite);

      const pLive = await safe(spotPrice(sym, 2200), null);
      const price = pLive ?? (closes1h.at(-1) ?? closes1d.at(-1) ?? null);
      return { coin, closes1h, closes1d, price, _priceSrc: pLive!=null ? "ticker" : (closes1h.length ? "kline-1h" : (closes1d.length ? "kline-1d" : null)) };
    });

<<<<<<< HEAD
        return { coin, closes1h, closes1d, _livePrice: live.price, _priceSrc: live.src };
      }))
    );

    // 3) Lokale signalen + pools + OI (met meerdere fallbacks) — OOK GEDOSEERD
=======
    // 2) Indicators per coin (gelimiteerde concurrency + fail-fast per stap)
>>>>>>> b451e384412f3d17c2aa1a5d1c295221c8855695
    type Pre = {
      coin: (typeof COINS)[number];
      closes1h: number[]; closes1d: number[];
      price: number|null;
      momentum: number|null; rawVol: number|null;
      funding: number|null; oi: number|null; lsr: number|null;
      bestApyEff: number|null;
      _fut?: string|null; _coinPerp?: string|null;
      _sources?: Record<string,string|null>;
    };

<<<<<<< HEAD
    const prelim: Pre[] = await Promise.all(
      klinesByCoin.map(({ coin, closes1h, closes1d, _livePrice, _priceSrc }) => limit(async () => {
        const spotSym = coin.pairUSD?.binance;
        const futSym  = toUsdtPerp(spotSym);
        const coinPerp = toCoinMarginedPerp(spotSym);
=======
    const prelim = await limitConcurrency(klinesByCoin, CONC, async ({ coin, closes1h, closes1d, price, _priceSrc }): Promise<Pre> => {
      const spot = coin.pairUSD?.binance;
      const fut  = toUsdtPerp(spot);
      const coinPerp = toCoinPerp(spot);
>>>>>>> b451e384412f3d17c2aa1a5d1c295221c8855695

      const momentum = closes1h.length ? momentumScoreFromCloses(closes1h) : null;
      const rv       = closes1h.length ? rawVol(closes1h, 72) : null;

      // Funding
      let funding = await safe(fundingUSDT(fut, TIME), null);
      if (!isNum(funding)) funding = await safe(fundingUSDT_hist(fut, TIME+400), null);
      if (!isNum(funding)) { const prov = Number(await safe(latestFundingRate(spot), null)); funding = Number.isFinite(prov) ? prov : null; }

      // Open interest (→ USD indien mogelijk)
      let oi = await safe(oiUSDT(fut, TIME), null);
      if (!isNum(oi)) oi = await safe(oiUSDT_hist(fut, TIME+500), null);
      if (isNum(oi) && isNum(price)) oi = oi * (price as number);

      // Long/Short skew → 0..1
      let lsr = await safe(lsrUSDT(fut, TIME), null);
      if (!isNum(lsr)) {
        const prov = await safe(globalLongShortSkew(spot), null);
        lsr = normalizeLsrInput(prov);
      }

      // Yield: baseline altijd; deep (=fast=0) probeert DeFiLlama
      let bestApyEff: number | null = BASELINE_APY[coin.symbol.toUpperCase()] ?? BASELINE_APY_DEFAULT;
      if (!FAST) {
        const pools = await safe(topPoolsForSymbol(coin.symbol, { minTvlUsd: 3_000_000, maxPools: 6 }) as any, []);
        for (const p of Array.isArray(pools) ? pools : []) {
          const apy = Number.isFinite(Number(p?.apy)) ? Number(p.apy) : Number(p?.apyBase || 0) + Number(p?.apyReward || 0);
          const tvl = Number(p?.tvlUsd || 0);
          if (!Number.isFinite(apy) || apy <= 0 || tvl < 3_000_000) continue;
          let q = 1; if (p?.stablecoin) q *= 0.85;
          const il = String(p?.ilRisk ?? p?.impermanentLossRisk ?? "").toLowerCase();
          if (il === "yes" || il === "true" || il === "1" || il === "high") q *= 0.70;
          bestApyEff = Math.max(bestApyEff ?? 0, apy * q);
        }
      }

<<<<<<< HEAD
        return { coin, closes1h, closes1d, tv, momentum, rawVol, funding, oi, lsr, pools, bestApyEff, _futSym: futSym, _coinPerp: coinPerp, _oiSource, _livePrice, _priceSrc };
      }))
    );
=======
      return { coin, closes1h, closes1d, price, momentum, rawVol: rv, funding, oi, lsr, bestApyEff, _fut: fut, _coinPerp: coinPerp, _sources: { price: _priceSrc } };
    });
>>>>>>> b451e384412f3d17c2aa1a5d1c295221c8855695

    // 3) Cross-sectionele metrics
    const momentumScores = prelim.map(p => isNum(p.momentum) ? p.momentum! : 0);
    const greenCount = momentumScores.filter(m => m >= 0.6).length;
    const breadth = COINS.length ? greenCount / COINS.length : 0.5;

    const volNorm01 = minmax(prelim.map(p => p.rawVol));
    const volRegScores = volNorm01.map((v,i) => {
      let s = 0.3 + 0.4 * (1 - v);
      const m = isNum(prelim[i].momentum) ? prelim[i].momentum! : 0.5;
      if (m < 0.45) s = Math.min(s, 0.6);
      return s;
    });

    // Yield percentielen (baseline/deep → altijd gevuld)
    const apysAll = prelim.map(p => p.bestApyEff).filter((x):x is number => Number.isFinite(x as number) && (x as number) > 0).sort((a,b)=>a-b);
    const p10 = apysAll.length >= 5 ? percentile(apysAll, 0.10) : 1.5;
    const p90 = apysAll.length >= 5 ? percentile(apysAll, 0.90) : 12;
    const yieldScoreFrom = (apy:number|null) => {
      if (!isNum(apy) || apy <= 0) return null;
      const z = (p90 - p10 <= 1e-9) ? Math.max(0, Math.min(1, apy / 12)) : Math.max(0, Math.min(1, (apy - p10)/(p90 - p10)));
      return 0.2 + 0.6 * z; // 0.2..0.8
    };

    // OI normaliseren
    const oiRaw = prelim.map(p => isNum(p.oi) ? p.oi! : null);
    const oiFinite = oiRaw.filter((x):x is number => x!=null);
    let oiNorm: number[] = oiRaw.map(()=>0.5);
    if (oiFinite.length >= 2) oiNorm = minmax(oiRaw);
    else if (oiFinite.length === 1) {
      const idx = oiRaw.findIndex(v => typeof v === "number");
      oiNorm = oiRaw.map((_,i)=> i===idx ? 0.8 : 0.5);
    }

    // 4) Output
    const results = prelim.map((p,i) => {
      // Funding score (cap ±0.05% / 8h)
      let fundingScore: number | null = null;
      if (isNum(p.funding)) {
        const capped = Math.max(-0.0005, Math.min(0.0005, p.funding as number));
        fundingScore = 0.5 + (capped/0.0005)*0.5;
      }

      // OI score
      let oiScore: number | null = Number.isFinite(oiNorm[i]) ? oiNorm[i] : null;
      if (isNum(oiScore)) {
        oiScore = 0.2 + 0.6 * Math.max(0, Math.min(1, oiScore as number));
        const m = isNum(p.momentum) ? p.momentum! : 0.5;
        if (m < 0.45) oiScore = Math.min(oiScore, 0.6);
      }

      // L/S skew → score
      let lsrScore: number | null = isNum(p.lsr) ? p.lsr! : null;
      if (isNum(lsrScore)) {
        const centered = lsrScore - 0.5;
        let s = 0.5 + centered * 0.6;
        if (lsrScore > 0.65) s -= (lsrScore - 0.65);
        if (lsrScore < 0.35) s += (0.35 - lsrScore);
        s = Math.max(0.3, Math.min(0.7, s));
        const m = isNum(p.momentum) ? p.momentum! : 0.5;
        if (m < 0.45) s = Math.min(s, 0.55);
        lsrScore = s;
      }

      const perf = {
        d: pctChange(p.closes1h, 24),
        w: pctChange(p.closes1h, 168),
        m: pctChange(p.closes1d, 30),
      };

      const price = p.price ?? (p.closes1h.at(-1) ?? p.closes1d.at(-1) ?? null);

      let yScore = yieldScoreFrom(p.bestApyEff);
      if (yScore != null) {
        const m = isNum(p.momentum) ? p.momentum! : 0.5;
        if (m < 0.45) yScore = Math.min(yScore, 0.55);
      }

      const breakdown = ({
        tvSignal: null,             // TV laten we in snelle pad weg om latency te sparen
        momentum: isNum(p.momentum) ? p.momentum : null,
        volatilityRegime: volRegScores[i],
        funding: fundingScore,
        openInterest: oiScore,
        longShortSkew: lsrScore,
        breadth, fearGreed,
        yield: yScore,
      } as unknown) as ComponentScoreNullable;

      const score = combineScores(breakdown);

      return {
        symbol: p.coin.symbol,
        name: p.coin.name,
        slug: p.coin.slug || p.coin.santimentSlug || p.coin.symbol.toLowerCase(),
        status: score.status,
        score: score.total,
        breakdown: score.breakdown,
        price,
        perf,
        meta: {
          fng: fngV,
          breadth: { green: greenCount, total: COINS.length, pct: breadth },
          yieldApyEff: p.bestApyEff,
          ...(DEBUG ? {
            __debug: {
              futSym: p._fut, coinPerp: p._coinPerp,
              priceSource: p._sources?.price ?? null,
            }
          } : {})
        },
      };
    });

    const payload:any = { updatedAt: Date.now(), results };
    setCache("SUMMARY", payload, 55_000);
    res.status(200).json(payload);
  } catch (e:any) {
    const payload = { updatedAt: Date.now(), results: [], __error: e?.message || String(e) };
    setCache("SUMMARY", payload, 10_000);
    res.status(200).json(payload);
  }
}