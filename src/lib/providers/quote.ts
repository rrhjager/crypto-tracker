// src/lib/providers/quote.ts

/**
 * Yahoo Finance (unofficial) chart API wrapper — resilient + backward compatible.
 * Accepts either a day count (e.g. 270) or a range string ('1y', '2y', ...).
 */

 export type YahooRange = '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y';

 const YAHOO_BASE =
   'https://query2.finance.yahoo.com/v8/finance/chart';
 
 /** Map "days" → Yahoo supported range. */
 function daysToRange(days: number): YahooRange {
   if (!Number.isFinite(days) || days <= 31) return '1mo';
   if (days <= 93) return '3mo';
   if (days <= 185) return '6mo';
   if (days <= 365) return '1y';
   if (days <= 730) return '2y';
   return '5y';
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
     `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
 
   const resp = await fetch(url, {
     headers: {
       accept: 'application/json',
       // Make Yahoo happier on edge runtimes:
       'user-agent':
         'Mozilla/5.0 (compatible; SignalHubBot/1.0; +https://www.signalhub.tech)',
     },
     // Avoid caching at edge in case you layer KV yourself:
     cache: 'no-store',
   });
 
   if (!resp.ok) {
     throw new Error(`Yahoo ${resp.status} for ${symbol} ${range}`);
   }
 
   const data = (await resp.json()) as any;
   const r = data?.chart?.result?.[0];
   const ts: any[] = r?.timestamp ?? [];
   const q = r?.indicators?.quote?.[0] ?? {};
   const closes: any[] = q?.close ?? [];
   const volumes: any[] = q?.volume ?? [];
 
   // Zip, clean, and keep at most maxPoints from the end:
   const zipped: Array<{ t: number; c: number; v: number }> = [];
   for (let i = 0; i < ts.length; i++) {
     const t = ts[i];
     const c = closes[i];
     const v = volumes[i];
     if (typeof t === 'number' && typeof c === 'number' && Number.isFinite(c)) {
       zipped.push({
         t,
         c,
         v: typeof v === 'number' && Number.isFinite(v) ? v : 0,
       });
     }
   }
 
   const out =
     typeof rangeOrDays === 'number'
       ? zipped.slice(-Math.max(1, Math.floor(rangeOrDays)))
       : zipped.slice(-Math.max(1, maxPoints));
 
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