// Binance USDT-M futures public endpoints (no key). We normalize outputs to 0..1 where possible.

function toSymbol(sym?: string): string | null {
    if (!sym) return null;
    // Expect e.g. "BTCUSDT" from coin.pairUSD.binance already
    return sym.endsWith("USDT") ? sym : `${sym}USDT`;
  }
  
  // Latest funding rate (most recent)
  export async function latestFundingRate(symbol?: string): Promise<number | null> {
    const s = toSymbol(symbol); if (!s) return null;
    const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${encodeURIComponent(s)}&limit=1`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    const item = Array.isArray(j) && j[0] ? j[0] : null;
    const rate = item ? Number(item.fundingRate) : NaN;
    return Number.isFinite(rate) ? rate : null; // e.g. 0.0001 = 0.01%
  }
  
  // Current open interest (absolute number). We scale across coins later by min-max within the set.
  // Hier schalen we eenvoudig met log10 voor een 0..1 proxy, maar je combineScores kan ook min-maxen.
  export async function currentOpenInterest(symbol?: string): Promise<number | null> {
    const s = toSymbol(symbol); if (!s) return null;
    const url = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(s)}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    const oi = Number(j?.openInterest);
    if (!Number.isFinite(oi)) return null;
    // log-scale to (0..1) rough normalization
    const x = Math.log10(Math.max(1, oi));
    // Typical OI ranges ~1e3..1e9 contracts; clamp 3..9
    const v = (Math.max(3, Math.min(9, x)) - 3) / 6;
    return Math.max(0, Math.min(1, v));
  }
  
  // Global long/short account ratio (binance public data)
  export async function globalLongShortSkew(symbol?: string): Promise<number | null> {
    const s = toSymbol(symbol); if (!s) return null;
    // period: 5m, limit: 1 (latest)
    const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${encodeURIComponent(s)}&period=5m&limit=1`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    const item = Array.isArray(j) && j[0] ? j[0] : null;
    const longRatio = item ? Number(item.longAccount) : NaN;   // in docs: longShortRatio, longAccount, shortAccount
    const shortRatio = item ? Number(item.shortAccount) : NaN;
    if (!Number.isFinite(longRatio) || !Number.isFinite(shortRatio)) {
      // fallback: try longShortRatio if provided (e.g. "1.25" → 55.6% long)
      const lsr = item ? Number(item.longShortRatio) : NaN;
      if (Number.isFinite(lsr)) {
        const longPct = lsr / (1 + lsr);
        return Math.max(0, Math.min(1, longPct)); // 0..1; 0.5 neutraal
      }
      return null;
    }
    const total = longRatio + shortRatio;
    if (total <= 0) return 0.5;
    return Math.max(0, Math.min(1, longRatio / total));
  }