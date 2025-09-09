// src/lib/indicators/volatilityRegime.ts
// Scoreert rustiger regimes hoger via percentiel-rank t.o.v. eigen historie.
// - Gebruikt dagdata (Binance spot), rollende 30d-vol van ln-returns
// - "Huidige" vol = gemiddelde van laatste 5 30d-vols (minder ruis)
// - Score = 1 - percentile(volNow)  (lage vol -> hoge score)
// - Lichte clip (0.05..0.95) voorkomt harde 0/1 waarden

export async function volatilityRegimeFromBinance(pair: string): Promise<number | null> {
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&limit=400`;
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return null;
      const k = await r.json() as any[];
  
      const closes: number[] = k.map(row => Number(row[4])).filter(Number.isFinite);
      if (closes.length < 90) return null;
  
      // dag-logreturns
      const rets: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        const p0 = closes[i - 1], p1 = closes[i];
        if (p0 > 0 && p1 > 0) rets.push(Math.log(p1 / p0));
      }
  
      // rollende 30d stdev
      const vols30: number[] = [];
      for (let i = 29; i < rets.length; i++) {
        vols30.push(stdev(rets.slice(i - 29, i + 1)));
      }
      if (vols30.length < 40) return null;
  
      // minder ruis: gemiddelde van laatste 5 30d-vols
      const volNow = mean(vols30.slice(-5));
  
      // referentie: laatste 365 entries excl. het allernieuwste
      const ref = vols30.slice(Math.max(0, vols30.length - 366), vols30.length - 1);
      if (ref.length < 30) return null;
  
      // percentiel-rank
      const sorted = [...ref].sort((a,b)=>a-b);
      const rank = percentileRank(sorted, volNow); // 0..1 (laag=0, hoog=1)
      let score = 1 - rank;                        // lage vol -> hoog
      // lichte clip zodat niets hard 0/1 wordt
      score = Math.min(0.95, Math.max(0.05, score));
      return score;
    } catch {
      return null;
    }
  }
  
  // helpers
  function mean(a: number[]) { return a.reduce((s, x) => s + x, 0) / a.length; }
  function stdev(a: number[]) {
    const m = mean(a);
    const v = a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length;
    return Math.sqrt(Math.max(v, 0));
  }
  function percentileRank(sorted: number[], x: number) {
    // lineaire interpolatie tussen posities; 0..1
    const n = sorted.length;
    if (n === 0) return 0.5;
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < x) lo = mid + 1; else hi = mid - 1;
    }
    // lo = #items < x ; interp met volgende
    if (lo === 0) return (x <= sorted[0]) ? 0 : (x - sorted[0]) / Math.max(1e-12, sorted[1] - sorted[0]) * (1 / (n - 1));
    if (lo >= n) return 1;
    const x0 = sorted[lo - 1], x1 = sorted[lo];
    const t = (x - x0) / Math.max(1e-12, x1 - x0);
    const idx = (lo - 1) + t;            // 0..n-1
    return Math.min(1, Math.max(0, idx / (n - 1)));
  }