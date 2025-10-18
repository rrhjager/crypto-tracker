// src/lib/providers/quote.ts
/**
 * Minimal Yahoo Finance daily OHLC fetcher used by indicator endpoints.
 * - Works on Vercel (Node runtime)
 * - No external deps
 * - Returns aligned timestamps + closes (filters out nulls)
 */

 export type YahooSeries = {
    timestamps: number[];   // epoch seconds
    closes: number[];       // close prices (same length as timestamps)
  }
  
  type YahooChartResp = {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{ close?: (number | null)[] }>;
        };
      }>;
      error?: { code?: string; description?: string };
    };
  };
  
  const YAHOO_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart';
  
  /**
   * Fetch daily closes for a symbol over a requested range (default 2y).
   * We clamp the result to `maxPoints` most-recent points to keep arrays small.
   */
  export async function getYahooDailyCloses(
    symbol: string,
    range: '1mo'|'3mo'|'6mo'|'1y'|'2y'|'5y' = '2y',
    maxPoints = 420
  ): Promise<YahooSeries> {
    const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  
    const resp = await fetch(url, {
      // DO NOT use next/edge cache hints here; API routes decide caching themselves
      headers: {
        'accept': 'application/json',
        // A UA reduces sporadic 403s on Yahoo
        'user-agent': 'Mozilla/5.0 (compatible; SignalHubBot/1.0; +https://www.signalhub.tech)',
      },
    });
  
    if (!resp.ok) {
      // propagate a *controlled* error; API routes catch and convert to 200/empty
      throw new Error(`Yahoo ${resp.status}`);
    }
  
    const data = (await resp.json()) as YahooChartResp;
    const r = data?.chart?.result?.[0];
    const ts = r?.timestamp || [];
    const closesRaw = r?.indicators?.quote?.[0]?.close || [];
  
    // Pair timestamps and closes, filter null/NaN, then slice to last N
    const zipped: Array<[number, number]> = [];
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      const c = closesRaw[i];
      if (typeof t === 'number' && typeof c === 'number' && Number.isFinite(c)) {
        zipped.push([t, c]);
      }
    }
  
    // Keep most recent maxPoints
    const recent = zipped.slice(-Math.max(1, maxPoints));
    const timestamps = recent.map(([t]) => t);
    const closes = recent.map(([, c]) => c);
  
    return { timestamps, closes };
  }