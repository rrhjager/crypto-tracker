// src/lib/providers/cryptopanic.ts
// CryptoPanic wrapper met cache + backoff voor free tier.
// Exporteert: newsImpactForSymbol(symbol: string, opts?: { hours?: number; debug?: boolean })

const CP_TOKEN = process.env.CRYPTOPANIC_API_KEY || "";
const CP_BASE = "https://cryptopanic.com/api/developer/v2/posts/";

// ====== Config ======
const TTL_SEC = Number(process.env.CRYPTOPANIC_TTL_SEC || "900");       // 15 min cache
const PAGES = Math.max(1, Math.min(3, Number(process.env.CRYPTOPANIC_PAGES || "1"))); // 1 pagina is zuinig
const COOLDOWN_SEC = Number(process.env.CRYPTOPANIC_COOLDOWN_SEC || "21600"); // 6 uur backoff na quota/rate limit
const DEFAULT_HOURS = 24;

// ====== Module-level cache (in-memory) ======
type CacheEntry<T> = { expires: number; data: T; meta?: any };
const cache = new Map<string, CacheEntry<any>>();
let cpCooldownUntil = 0; // epoch ms

// ====== Heuristiek woorden ======
const POS_WORDS = [
  "surge","rally","soars","bull","buy","partnership","approve","approved",
  "launch","funding","upgrade","etf","record","all-time high","ath","breakout",
  "positive","wins","win","settlement","integration","listing","listed","up","spike","pump"
];
const NEG_WORDS = [
  "hack","exploit","down","dump","bear","sell","lawsuit","sue","ban","halt",
  "halted","delay","delayed","reject","rejected","rug","liquidation","scam",
  "negative","crash","fall","fud","pause","paused","outage","fine","sec","cftc"
];

function scoreFromTitle(t: string) {
  const lower = (t || "").toLowerCase();
  let pos = 0, neg = 0;
  for (const w of POS_WORDS) if (lower.includes(w)) pos++;
  for (const w of NEG_WORDS) if (lower.includes(w)) neg++;
  return { pos, neg };
}

const SYMBOL_QUERY: Record<string, string> = {
  BTC: "(bitcoin OR btc)",
  ETH: "(ethereum OR eth)",
  BNB: "(binance coin OR bnb)",
  XRP: "(xrp OR ripple)",
  ADA: "(cardano OR ada)",
  SOL: "(solana OR sol)",
  DOGE: "(dogecoin OR doge)",
  TON: "(toncoin OR ton)",
  TRX: "(tron OR trx)",
  AVAX: "(avalanche OR avax)",
};

type NewsImpact = {
  bullish: number;
  bearish: number;
  important: number;
  score: number | null;     // null => N/A in UI
  sample?: Array<{ title: string; url?: string }>;
  _debug?: { cache: "hit" | "miss" | "cooldown"; fetched?: number };
};

async function fetchCryptoPanicPages(q: string, pages: number): Promise<any[]> {
  if (!CP_TOKEN) throw new Error("Missing CRYPTOPANIC_API_KEY");
  let url = `${CP_BASE}?auth_token=${encodeURIComponent(CP_TOKEN)}&public=true&q=${encodeURIComponent(q)}`;
  const out: any[] = [];
  for (let i = 0; i < pages; i++) {
    const r = await fetch(url, { cache: "no-store" });
    const txt = await r.text();
    let j: any;
    try { j = JSON.parse(txt); } catch { throw new Error(`CryptoPanic invalid JSON`); }

    if (!r.ok) {
      const info = (j && (j.info || j.detail || j.message)) || `HTTP ${r.status}`;
      // Detect quota/rate limit → trigger cooldown
      if (String(info).toLowerCase().includes("quota") || String(info).toLowerCase().includes("rate limit")) {
        cpCooldownUntil = Date.now() + COOLDOWN_SEC * 1000;
      }
      throw new Error(`CryptoPanic error: ${info}`);
    }

    if (Array.isArray(j.results)) out.push(...j.results);
    if (j.next) url = j.next; else break;
  }
  return out;
}

export async function newsImpactForSymbol(
  symbol: string,
  opts?: { hours?: number; debug?: boolean }
): Promise<NewsImpact | null> {
  const hours = Math.max(1, Math.min(72, Number(opts?.hours ?? DEFAULT_HOURS)));
  const since = Date.now() - hours * 3600 * 1000;
  const q = SYMBOL_QUERY[symbol?.toUpperCase() || ""] || symbol;

  // Cooldown? → geen call, direct N/A
  if (Date.now() < cpCooldownUntil) {
    return {
      bullish: 0, bearish: 0, important: 0, score: null,
      ...(opts?.debug ? { _debug: { cache: "cooldown" } } : {})
    };
  }

  const key = `cp:${q}:h${hours}:p${PAGES}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) {
    return {
      ...cached.data,
      ...(opts?.debug ? { _debug: { cache: "hit", fetched: cached.meta?.fetchedAt } } : {})
    };
  }

  // Fetch (miss)
  try {
    const items = await fetchCryptoPanicPages(q, PAGES);

    const recent = items.filter((it: any) => {
      const ts = Date.parse(it?.published_at || it?.created_at || "");
      return Number.isFinite(ts) && ts >= since;
    });

    if (!recent.length) {
      const result: NewsImpact = {
        bullish: 0, bearish: 0, important: 0, score: null,
        ...(opts?.debug ? { _debug: { cache: "miss", fetched: now } } : {})
      };
      cache.set(key, { expires: now + TTL_SEC * 1000, data: result, meta: { fetchedAt: now } });
      return result;
    }

    let bull = 0, bear = 0, imp = 0;
    const sample: Array<{ title: string; url?: string }> = [];

    for (const it of recent) {
      const title: string = it?.title || "";
      if (/breaking|important|urgent/i.test(title)) imp++;
      const { pos, neg } = scoreFromTitle(title);
      if (pos > neg) bull++;
      else if (neg > pos) bear++;
      if (sample.length < 5) sample.push({ title, url: it?.url || it?.source?.url });
    }

    // Smoothen en clampen
    const raw = (bull - bear + 0.5 * imp) / 8;
    const s = (Math.tanh(raw) + 1) / 2; // [0..1]
    const result: NewsImpact = {
      bullish: bull,
      bearish: bear,
      important: imp,
      score: Number.isFinite(s) ? s : null,
      ...(opts?.debug ? { sample, _debug: { cache: "miss", fetched: now } } : {})
    };

    cache.set(key, { expires: now + TTL_SEC * 1000, data: result, meta: { fetchedAt: now } });
    return result;
  } catch (e: any) {
    // Bij error: zet korte cache met N/A om storm te voorkomen
    const fallback: NewsImpact = {
      bullish: 0, bearish: 0, important: 0, score: null,
      ...(opts?.debug ? { _debug: { cache: "miss" } } : {})
    };
    cache.set(key, { expires: now + Math.min(TTL_SEC, 120) * 1000, data: fallback, meta: { fetchedAt: now } });
    return fallback;
  }
}