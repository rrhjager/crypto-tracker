// src/pages/api/v1/coins.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getCache, setCache } from "@/lib/cache";
import { fetchSafe } from "@/lib/fetchSafe";

type Json = Record<string, any>;

const CACHE_KEY = "coins:v1:fast=1";
const TTL_SECONDS = 30;

function setSWRHeaders(res: NextApiResponse) {
  // CDN cache for 30s, allow stale for 60s while revalidating
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Json>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // 1) Try shared cache first
    const cached = await getCache<Json>(CACHE_KEY);
    if (cached) {
      setSWRHeaders(res);
      return res.status(200).json(cached);
    }

    // 2) No cache → build by calling refresh on the same deployment
    const proto = (req.headers["x-forwarded-proto"] as string) || "https";
    const host = req.headers.host;
    const origin = `${proto}://${host}`;

    const r = await fetchSafe(`${origin}/api/v1/refresh?fast=1`, {
      // Ensure this isn't cached by any intermediate fetch layer
      cache: "no-store",
      headers: { "x-internal": "coins" },
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({ error: "refresh_failed", details: text });
    }

    const data = (await r.json()) as Json;

    // 3) Persist to shared cache (TTL ~ 30s) and return
    await setCache(CACHE_KEY, data, TTL_SECONDS);
    setSWRHeaders(res);
    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(500).json({ error: "internal_error", details: String(err?.message || err) });
  }
}