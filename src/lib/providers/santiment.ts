// src/lib/providers/santiment.ts
const SAN_ENDPOINT = "https://api.santiment.net/graphql";
const SAN_KEY = process.env.SANTIMENT_API_KEY || "";

// Generieke GraphQL helper
async function sanQuery<T = any>(query: string, variables: Record<string, any> = {}): Promise<T> {
  // Als er geen key is, gooi een nette error zodat de aanroeper kan fallbacken
  if (!SAN_KEY) throw new Error("SANTIMENT_API_KEY missing");
  const res = await fetch(SAN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Apikey ${SAN_KEY}` },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Santiment HTTP ${res.status}`);
  const j = await res.json();
  if (j.errors?.length) throw new Error(j.errors[0]?.message || "Santiment error");
  return j.data;
}

// ====== Bestaande exports die je al gebruikte ======
// (laat staan; jouw project importeert deze elders)
export async function sanPriceChange(
  slugs: string[],
  window: "1d" | "7d" | "30d"
): Promise<Record<string, number>> {
  // ... jouw bestaande implementatie (niet wijzigen)
  // (laat dit staan zoals het bij jou stond)
  return {};
}
export async function sanVolatility30d(slug: string): Promise<number> {
  // ... bestaande implementatie
  return 0.5;
}
export async function sanPumpDump(slug: string): Promise<number> {
  // ... bestaande implementatie
  return 0.5;
}

// ====== NIEUW: Whale flow 24h die veilig fallbackt ======
/**
 * Whale flow over 24h:
 *  - Eerst probeert hij de sommen van exchange_inflow_usd / exchange_outflow_usd (1h interval)
 *  - Zo niet, dan fallback via delta van exchange_balance_usd
 *  - Bij fouten of ontbrekende key → neutrale HOLD-score (0.5) en 0-bedragen
 */
export async function whaleFlow24hUSD(slug: string): Promise<{
  inflowUSD: number;      // som naar exchanges (USD)
  outflowUSD: number;     // som van exchanges af (USD)
  netUSD: number;         // outflow - inflow (USD)
  score: number;          // 0.1 SELL (outflow dominant), 0.9 BUY (inflow dominant), 0.5 HOLD
  direction: "INFLOW" | "OUTFLOW" | "FLAT";
  used: "io_sum" | "balance_delta" | "none";
}> {
  // Geen key? Geef neutraal terug, zodat niets crasht.
  if (!SAN_KEY) {
    return { inflowUSD: 0, outflowUSD: 0, netUSD: 0, score: 0.5, direction: "FLAT", used: "none" };
  }

  // 1) Probeer som inflow/outflow
  const qIO = `
    query ($slug:String!) {
      inflow:getMetric(metric:"exchange_inflow_usd") {
        timeseriesDataJson(selector:{slug:$slug}, from:"utc_now-24h", to:"utc_now", interval:"1h")
      }
      outflow:getMetric(metric:"exchange_outflow_usd") {
        timeseriesDataJson(selector:{slug:$slug}, from:"utc_now-24h", to:"utc_now", interval:"1h")
      }
    }
  `;
  try {
    const d = await sanQuery<{ inflow:{timeseriesDataJson:string}, outflow:{timeseriesDataJson:string} }>(qIO, { slug });
    const infl = JSON.parse(d.inflow?.timeseriesDataJson || "[]") as Array<{ value: number }>;
    const outf = JSON.parse(d.outflow?.timeseriesDataJson || "[]") as Array<{ value: number }>;
    const inflowUSD = Math.round(infl.reduce((s, x) => s + Number(x?.value || 0), 0));
    const outflowUSD = Math.round(outf.reduce((s, x) => s + Number(x?.value || 0), 0));

    if (inflowUSD > 0 || outflowUSD > 0) {
      const netUSD = outflowUSD - inflowUSD;
      return mapNetToScore({ inflowUSD, outflowUSD, netUSD, used: "io_sum" });
    }
  } catch {
    // ga door naar fallback
  }

  // 2) Fallback: delta exchange_balance_usd (laatste - eerste)
  try {
    const qBal = `
      query ($slug:String!) {
        bal:getMetric(metric:"exchange_balance_usd") {
          timeseriesDataJson(selector:{slug:$slug}, from:"utc_now-25h", to:"utc_now", interval:"1h")
        }
      }
    `;
    const d2 = await sanQuery<{ bal:{ timeseriesDataJson: string } }>(qBal, { slug });
    const arr = JSON.parse(d2.bal?.timeseriesDataJson || "[]") as Array<{ value: number }>;
    const first = Number(arr?.[0]?.value ?? 0);
    const last  = Number(arr?.[arr.length - 1]?.value ?? 0);
    // Als balance toeneemt ⇒ netto INflow; daalt ⇒ netto OUTflow.
    const netUSD_proxy = (last - first) * -1; // teken omdraaien: outflow positief
    const inflowUSD = 0;
    const outflowUSD = netUSD_proxy > 0 ? Math.round(netUSD_proxy) : 0;
    const netUSD = Math.round(netUSD_proxy);
    return mapNetToScore({ inflowUSD, outflowUSD, netUSD, used: "balance_delta" });
  } catch {
    // Nog steeds fout? Geef neutraal terug i.p.v. throw.
    return { inflowUSD: 0, outflowUSD: 0, netUSD: 0, score: 0.5, direction: "FLAT", used: "none" };
  }
}

// Heuristische mapping van netto-flow naar 0..1 score
function mapNetToScore({ inflowUSD, outflowUSD, netUSD, used }:{
  inflowUSD: number; outflowUSD: number; netUSD: number; used: "io_sum" | "balance_delta" | "none";
}) {
  const magnitude = Math.abs(netUSD);
  // Drempel: min $1M of 15% van totale 24h flow — mild zodat alleen duidelijke signalen tellen
  const base = 1_000_000;
  const flowScale = Math.max(0, outflowUSD + inflowUSD);
  const threshold = Math.max(base, Math.round(flowScale * 0.15));

  let direction: "INFLOW" | "OUTFLOW" | "FLAT" = "FLAT";
  let score = 0.5; // HOLD
  if (magnitude >= threshold) {
    if (netUSD > 0) {           // OUTflow dominant → SELL
      direction = "OUTFLOW";
      score = 0.1;
    } else if (netUSD < 0) {    // INflow dominant → BUY
      direction = "INFLOW";
      score = 0.9;
    }
  }
  return { inflowUSD, outflowUSD, netUSD, score, direction, used };
}