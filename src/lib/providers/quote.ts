// src/lib/providers/quote.ts

/**
 * Yahoo Finance (unofficial) chart API wrapper — resilient + backward compatible.
 * Accepts either a day count (e.g. 270) or a range string ('1y', '2y', ...).
 */

 export type YahooRange = '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y';

 const YAHOO_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart';
 
 /** Map "days" → Yahoo supported range. */
 function daysToRange(days: number): YahooRange {
   if (!Number.isFinite(days) || days <= 31) return '1mo';
   if (days <= 93) return '3mo';
   if (days <= 185) return '6mo';
   if (days <= 365) return '1y';
   if (days <= 730) return '2y';
   return '5y';
 }
 
 /** Small fetch wrapper with retry + timeout (no external deps). */
 async function fetchWithRetry(
   url: string,
   init: RequestInit = {},
   retries = 2,
   timeoutMs = 9000
 ): Promise<Response> {
   let lastErr: unknown;
   for (let attempt = 0; attempt <= retries; attempt++) {
     const controller = new AbortController();
     const timer = setTimeout(() => controller.abort(), timeoutMs);
     try {
       const res = await fetch(url, {
         ...init,
         signal: controller.signal,
       });
       clearTimeout(timer);
       if (!res.ok) throw new Error(`HTTP ${res.status}`);
       return res;
     } catch (e) {
       clearTimeout(timer);
       lastErr = e;
       if (attempt === retries) break;
       // Simple backoff: 300ms, 600ms, ...
       await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
     }
   }
   throw lastErr instanceof Error ? lastErr : new Error('Fetch failed');
 }
 
 /** Fetch OHLC arrays (timestamps, close, volume). */
 export async function getYahooDailyOHLC(
   symbol: string,
   rangeOrDays: YahooRange | number = '2y',
   maxPoints = 420
 ): Promise<{ timestamps: number[]; closes: number[]; volumes: number[] }> {
   const range =
     typeof rangeOrDays === 'number'
       ? daysToRange(Math.max(1, Math.floor(rangeOrDays)))
       : rangeOrDays;
 
   const url =
     `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=${range}&includePrePost=false`;
 
   const resp = await fetchWithRetry(url, {
     headers: {
       accept: 'application/json',
       // Be kind to Yahoo infra; looks less botty and helps on some edges.
       'user-agent': 'Mozilla/5.0 (compatible; SignalHubBot/1.0; +https://www.signalhub.tech)',
     },
     // Laat hogere lagen (KV/edge) bepalen wat er gecachet wordt:
     cache: 'no-store',
   });
 
   const data = (await resp.json()) as any;
   const r = data?.chart?.result?.[0] ?? {};
   const ts: unknown[] = Array.isArray(r?.timestamp) ? r.timestamp : [];
 
   const q = r?.indicators?.quote?.[0] ?? {};
   const closesPrimary: unknown[] = Array.isArray(q?.close) ? q.close : [];
   const volumesRaw: unknown[] = Array.isArray(q?.volume) ? q.volume : [];
 
   // Fallback: sommige responses hebben nulls in quote.close maar wel values in adjclose.adjclose
   const adj = r?.indicators?.adjclose?.[0] ?? {};
   const closesAdj: unknown[] = Array.isArray(adj?.adjclose) ? adj.adjclose : [];
 
   // Zip, clean, en keep maxPoints van het einde:
   const zipped: Array<{ t: number; c: number; v: number }> = [];
   const N = Array.isArray(ts) ? ts.length : 0;
 
   for (let i = 0; i < N; i++) {
     const t = ts[i];
     const c0 = closesPrimary[i];
     const c1 = closesAdj[i];
     // kies primary close; zoniet, pak adjclose
     const c =
       typeof c0 === 'number' && Number.isFinite(c0)
         ? c0
         : typeof c1 === 'number' && Number.isFinite(c1)
         ? c1
         : null;
 
     const v0 = volumesRaw[i];
     const v =
       typeof v0 === 'number' && Number.isFinite(v0) ? v0 : 0;
 
     if (typeof t === 'number' && Number.isFinite(t) && typeof c === 'number') {
       zipped.push({ t, c, v });
     }
   }
 
   const out =
     typeof rangeOrDays === 'number'
       ? zipped.slice(-Math.max(1, Math.floor(rangeOrDays)))
       : zipped.slice(-Math.max(1, Math.min(maxPoints, zipped.length)));
 
   return {
     timestamps: out.map(x => x.t),
     closes: out.map(x => x.c),
     volumes: out.map(x => x.v),
   };
 }
 
 /** Backward-compatible: get only closes, accepts days or range. */
 export async function getYahooDailyCloses(
   symbol: string,
   rangeOrDays: YahooRange | number = '2y',
   maxPoints = 420
 ): Promise<number[]> {
   const { closes } = await getYahooDailyOHLC(symbol, rangeOrDays, maxPoints);
   return closes;
 }
 
 /** For volume indicator. */
 export async function getYahooDailyVolumes(
   symbol: string,
   rangeOrDays: YahooRange | number = '2y',
   maxPoints = 420
 ): Promise<number[]> {
   const { volumes } = await getYahooDailyOHLC(symbol, rangeOrDays, maxPoints);
   return volumes;
 }