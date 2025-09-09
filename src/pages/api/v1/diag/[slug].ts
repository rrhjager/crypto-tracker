import type { NextApiRequest, NextApiResponse } from "next";
import { getCache } from "@/lib/cache";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const slug = String(req.query.slug || "");
  let cached = getCache<any>("SUMMARY");

  // Auto-warm: als cache leeg is, run refresh 1x
  if (!cached) {
    try {
      const host = req.headers.host || "localhost:3000";
      await fetch(`http://${host}/api/v1/refresh?debug=1`, { cache: "no-store" });
      cached = getCache<any>("SUMMARY");
    } catch (_) {}
  }

  if (!cached) return res.status(503).json({ error: "No data after refresh." });

  const coin = cached.results?.find((c:any)=> c.slug === slug);
  if (!coin) return res.status(404).json({ error: `Coin ${slug} not in cache`, have: cached.results?.map((r:any)=>r.slug) });

  res.status(200).json({
    slug,
    perf: coin.perf,
    breakdown: coin.breakdown,   // null = N/A
    meta: coin.meta,
    score: coin.score,
    status: coin.status,
    updatedAt: cached.updatedAt,
    debug: cached.__debug?.[slug] || null, // per-coin debug (zie patch hieronder)
  });
}