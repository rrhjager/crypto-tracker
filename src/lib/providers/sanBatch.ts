const SAN_ENDPOINT = "https://api.santiment.net/graphql";
const SAN_KEY = process.env.SANTIMENT_API_KEY || "";

async function sanQuery(query: string, variables: any = {}) {
  if (!SAN_KEY) throw new Error("Missing SANTIMENT_API_KEY");
  const res = await fetch(SAN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Apikey ${SAN_KEY}` },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`Santiment ${res.status}`);
  const j = await res.json();
  if (j.errors?.length) throw new Error(j.errors[0].message || "San error");
  return j.data;
}

export async function sanTimeseriesPerSlug(
  slugs: string[],
  metric: string,
  fromIso: string,
  toIso: string,
  interval: "5m" | "1h" | "1d"
): Promise<Record<string, { t: number, v: number }[]>> {
  const q = `
    query($slugs:[String!]!,$from:String!,$to:String!,$int:String!){
      getMetric(metric: "${metric}") {
        timeseriesDataPerSlugJson(selector:{slugs:$slugs}, from:$from, to:$to, interval:$int)
      }
    }`;
  const data = await sanQuery(q, { slugs, from: fromIso, to: toIso, int: interval });
  const raw = data.getMetric?.timeseriesDataPerSlugJson;
  const json = typeof raw === "string" ? JSON.parse(raw) : raw;
  const out: Record<string, { t: number, v: number }[]> = {};
  for (const slug of slugs) {
    const arr = (json?.[slug] || []) as any[];
    out[slug] = arr.map((row: any) => {
      if (Array.isArray(row)) return { t: Number(new Date(row[0]).getTime()), v: Number(row[1]) };
      return { t: Date.parse(row.datetime), v: Number(row.value) };
    }).filter(x => isFinite(x.t) && isFinite(x.v));
  }
  return out;
}

// Volatiliteit (30d, 1h)
export function volatility30dFromSeries(price: { t: number, v: number }[]): number | null {
  if (!price || price.length < 10) return null;
  const rets: number[] = [];
  for (let i = 1; i < price.length; i++) {
    const p0 = price[i - 1].v, p1 = price[i].v;
    if (!p0 || !p1) continue;
    rets.push(Math.log(p1 / p0));
  }
  if (rets.length < 5) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, (rets.length - 1));
  const volAnn = Math.sqrt(v) * Math.sqrt(24 * 365);
  return Math.max(0, Math.min(1, 1 - (volAnn / 1.5)));
}

// Pump&Dump (2h, 5m)
export function pumpDumpFromSeries(
  price5m: { t: number, v: number }[],
  social5m: { t: number, v: number }[]
): number | null {
  if (!price5m?.length || !social5m?.length) return null;
  const n = price5m.length;
  if (n < 6) return null;
  const last = price5m[n - 1].v;
  const prev = price5m[Math.max(0, n - 4)].v;
  if (!last || !prev) return null;
  const ret = (last - prev) / prev;

  const m = social5m.length;
  const socLast = social5m[m - 1].v;
  const base = social5m.slice(Math.max(0, m - 24), Math.max(0, m - 4)).map(x => x.v).filter(x => isFinite(x));
  const baseAvg = base.length ? base.reduce((a, b) => a + b, 0) / base.length : 0;
  const ratio = baseAvg > 0 ? (socLast / baseAvg) : 1;

  let score = 0.7;
  if (ret > 0.02 && ratio > 2) score = 0.2;
  else if (ret < -0.02 && ratio > 2) score = 0.3;
  else if (Math.abs(ret) < 0.01 && ratio < 1.2) score = 0.85;
  return Math.max(0, Math.min(1, score));
}

// Whale spike (7d, 1h) => laatste bar vs 7d-avg
export function whaleSpikeFromSeries(series: { t: number, v: number }[]): number | null {
  if (!series || series.length < 5) return null;
  const last = series[series.length - 1].v;
  const base = series.slice(0, -1).map(x => x.v);
  if (!base.length) return null;
  const avg = base.reduce((a, b) => a + b, 0) / base.length;
  if (!isFinite(avg) || avg <= 0) return 0.5;
  const ratio = Math.min(last / avg, 5); // cap
  // 0 bij ratio 0.5, 1 bij ratio 3
  const score = Math.max(0, Math.min(1, (ratio - 0.5) / (3 - 0.5)));
  return score;
}