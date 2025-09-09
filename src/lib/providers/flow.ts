// src/lib/providers/flow.ts
// Inflow/Outflow via Santiment (FREE-compatible):
// - gebruikt exchange_inflow / exchange_outflow in NATIVE units
// - vermenigvuldigt met gemiddelde price_usd om USD te schatten
// - optionele 'delayDays' om binnen de FREE "30d delay" te vallen
// - veilige fallbacks + duidelijke debug

const SAN_ENDPOINT = "https://api.santiment.net/graphql";
const SAN_KEY = process.env.SANTIMENT_API_KEY || "";

type FlowResult = {
  inflowUSD: number;
  outflowUSD: number;
  netUSD: number;
  score: number | null; // null = N/A
  direction: "INFLOW" | "OUTFLOW" | "FLAT";
  used: "io_sum" | "balance_delta" | "no_data" | "rate_limited" | "outside_window" | "other_error";
  __debug?: any;
};

function toISO(d: Date) { return d.toISOString().replace(/\.\d{3}Z$/, "Z"); }

async function sanQuery<T = any>(query: string, variables: Record<string, any>): Promise<T> {
  if (!SAN_KEY) throw new Error("Missing SANTIMENT_API_KEY");
  const r = await fetch(SAN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Apikey ${SAN_KEY}` },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const txt = await r.text();
  let json: any = null;
  try { json = JSON.parse(txt); } catch { /* raw text in txt */ }
  if (!r.ok) {
    const msg = (json && json.errors && json.errors[0]?.message) || txt || `Santiment HTTP ${r.status}`;
    throw new Error(msg);
  }
  if (json?.errors?.length) throw new Error(json.errors[0]?.message || "Santiment error");
  return json.data;
}

/** Zet netflow in USD om naar score:
 *  - netUSD = outflowUSD - inflowUSD (positief = outflow domineert = bullish)
 *  - drempel: max($1M, 15% van totale flow)
 *  - mapping: 0.1 SELL (inflow domineert sterk), 0.9 BUY (outflow domineert sterk), anders 0.5 HOLD
 */
function mapNetToScore(inflowUSD: number, outflowUSD: number) {
  const netUSD = Math.round(outflowUSD - inflowUSD);
  const total = Math.max(0, inflowUSD + outflowUSD);
  const threshold = Math.max(1_000_000, Math.round(total * 0.15));

  let direction: "INFLOW" | "OUTFLOW" | "FLAT" = "FLAT";
  let score: number | null = 0.5;

  if (Math.abs(netUSD) < threshold) {
    direction = "FLAT";
    score = 0.5;
  } else if (netUSD > 0) {
    direction = "OUTFLOW";
    score = 0.9; // BUY
  } else {
    direction = "INFLOW";
    score = 0.1; // SELL
  }

  return { netUSD, score, direction, threshold };
}

/** Haal 24h inflow/outflow op in native units + average price, projecteer naar USD.
 *  opts.delayDays: 0 = realtime (PRO/PLUS); 31..40 = gratis (vertraagd ~30d).
 *  opts.debug: voeg __debug velden toe.
 */
export async function whaleFlow24hUSD(
  slug: string,
  opts: { delayDays?: number; debug?: boolean } = {}
): Promise<FlowResult> {
  const delayDays = Number.isFinite(opts.delayDays) ? Math.max(0, Math.floor(opts.delayDays!)) : 0;

  // Window bepalen (24h)
  const to = new Date(Date.now() - delayDays * 24 * 3600 * 1000);
  const from = new Date(to.getTime() - 24 * 3600 * 1000);

  const q = `
    query($slug:String!, $from:DateTime!, $to:DateTime!, $int:String!) {
      inflow:getMetric(metric:"exchange_inflow") {
        timeseriesData(selector:{slug:$slug}, from:$from, to:$to, interval:$int){ datetime value }
      }
      outflow:getMetric(metric:"exchange_outflow") {
        timeseriesData(selector:{slug:$slug}, from:$from, to:$to, interval:$int){ datetime value }
      }
      price:getMetric(metric:"price_usd") {
        timeseriesData(selector:{slug:$slug}, from:$from, to:$to, interval:$int){ datetime value }
      }
    }
  `;

  const variables = { slug, from: toISO(from), to: toISO(to), int: "1h" };
  const debugBag: any = { slug, from: variables.from, to: variables.to, delayDays };

  try {
    const data = await sanQuery<{
      inflow: { timeseriesData: Array<{ datetime: string; value: number }> };
      outflow:{ timeseriesData: Array<{ datetime: string; value: number }> };
      price:  { timeseriesData: Array<{ datetime: string; value: number }> };
    }>(q, variables);

    const inflowN = (data.inflow?.timeseriesData || []).reduce((s, x) => s + Number(x.value || 0), 0);
    const outflowN= (data.outflow?.timeseriesData|| []).reduce((s, x) => s + Number(x.value || 0), 0);
    const pArr   = (data.price?.timeseriesData  || []).map(x => Number(x.value || 0)).filter(n => Number.isFinite(n));
    const avgP   = pArr.length ? pArr.reduce((a,b)=>a+b,0)/pArr.length : 0;

    const inflowUSD  = Math.round(inflowN  * avgP);
    const outflowUSD = Math.round(outflowN * avgP);

    if (!Number.isFinite(inflowUSD) || !Number.isFinite(outflowUSD)) {
      return { inflowUSD:0, outflowUSD:0, netUSD:0, score:null, direction:"FLAT", used:"no_data", __debug: opts.debug ? { ...debugBag, note:"non-finite inflow/outflow" } : undefined };
    }

    const { netUSD, score, direction, threshold } = mapNetToScore(inflowUSD, outflowUSD);
    return { inflowUSD, outflowUSD, netUSD, score, direction, used:"io_sum", __debug: opts.debug ? { ...debugBag, avgPrice:avgP, threshold } : undefined };

  } catch (e:any) {
    const msg = String(e?.message || e);
    debugBag.error = msg;

    // FREE: buiten toegestane periode
    if (msg.includes("outside the allowed interval")) {
      return { inflowUSD:0, outflowUSD:0, netUSD:0, score:null, direction:"FLAT", used:"outside_window", __debug: opts.debug ? debugBag : undefined };
    }
    // Rate limit
    if (msg.toLowerCase().includes("rate limit")) {
      return { inflowUSD:0, outflowUSD:0, netUSD:0, score:null, direction:"FLAT", used:"rate_limited", __debug: opts.debug ? debugBag : undefined };
    }
    // Overig
    return { inflowUSD:0, outflowUSD:0, netUSD:0, score:null, direction:"FLAT", used:"other_error", __debug: opts.debug ? debugBag : undefined };
  }
}