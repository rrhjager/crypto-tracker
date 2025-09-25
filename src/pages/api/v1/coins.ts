// src/pages/api/v1/coins.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getCache, setCache, setCacheHeaders } from "@/lib/cache";
import { fetchSafe } from "@/lib/fetchSafe";

/**
 * Bepaalt de absolute base URL voor interne calls.
 * Werkt lokaal en op Vercel (via x-forwarded-* headers).
 */
function baseUrl(req: NextApiRequest): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (req.headers["x-forwarded-protocol"] as string) ||
    "http";
  const host =
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers["host"] as string) ||
    "localhost:3000";
  return `${proto}://${host}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Cache headers (korte TTL omdat we toch vaak verversen)
  setCacheHeaders(res, 20, 60);

  const fast = req.query.fast === "0" ? 0 : 1; // default fast=1
  const cacheKey = `v1/coins?fast=${fast}`;

  // 1) Probeer cache
  const cached = getCache<any>(cacheKey);
  if (cached?.data && Array.isArray(cached.data.results) && cached.data.results.length > 0) {
    return res.status(200).json(cached.data);
  }

  // 2) GEEN cache → synchronisch verversen i.p.v. "background warm-up"
  //    Bel direct de refresh-endpoint en geef diens payload door.
  try {
    const url = `${baseUrl(req)}/api/v1/refresh?fast=${fast}&from=coins`;
    const r = await fetchSafe(url, { timeout: 60000 }); // geef refresh genoeg tijd

    if (r.ok && r.data && Array.isArray(r.data.results)) {
      // Optioneel: ook in-memory cache zetten voor herhaalde hits in dezelfde lambda
      setCache(cacheKey, r.data, 55);
      return res.status(200).json(r.data);
    }

    // Als refresh niks oplevert, val terug op "warming up"
    return res.status(200).json({
      updatedAt: Date.now(),
      results: [],
      message: r.error || "Warming up cache…",
    });
  } catch (e: any) {
    // Veilig falen
    return res.status(200).json({
      updatedAt: Date.now(),
      results: [],
      message: e?.message || "Error during refresh",
    });
  }
}