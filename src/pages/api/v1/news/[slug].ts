// src/pages/api/v1/news/[slug].ts
import type { NextApiRequest, NextApiResponse } from "next";
import Parser from "rss-parser";
import { fetchSafe } from "@/lib/fetchSafe";

// -----------------------------------------------
// FIX: Set Google News language/region to ENGLISH
// -----------------------------------------------
const HL = "en-US";
const GL = "US";
const CEID = "US:en";

type NewsItem = {
  id: string;
  title: string;
  link: string;
  source?: string;
  pubDate?: string;
};

type NewsResponse = {
  updatedAt: number;
  query: string;
  items: NewsItem[];
};

const parser = new Parser({
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; CryptoNewsBot/1.0)",
  },
});

// Consistent CDN-friendly headers
function setCacheHeaders(res: NextApiResponse, smaxage = 600, swr = 300) {
  const value = `public, s-maxage=${smaxage}, stale-while-revalidate=${swr}`;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", value);
  res.setHeader("CDN-Cache-Control", value);
  res.setHeader("Vercel-CDN-Cache-Control", value);
  res.setHeader("Timing-Allow-Origin", "*");
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<NewsResponse | { error: string }>
) {
  const rawSlug = req.query.slug;
  const nameParam = (req.query.name as string | undefined)?.trim();

  const symbol = String(
    Array.isArray(rawSlug) ? rawSlug[0] : rawSlug || ""
  ).toUpperCase();

  const base =
    nameParam && nameParam.length > 0 ? nameParam : symbol || "crypto";

  const query = `${base} crypto`;

  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
      query
    )}&hl=${HL}&gl=${GL}&ceid=${CEID}`;

    // Robust fetch (timeout + retry)
    const r = await fetchSafe(url, { cache: "no-store" }, 7000, 1);

    if (!r.ok) {
      setCacheHeaders(res, 300, 120);
      return res
        .status(200)
        .json({ updatedAt: Date.now(), query, items: [] });
    }

    const xml = await r.text();
    const feed = await parser.parseString(xml);

    const items: NewsItem[] = (feed.items || [])
      .slice(0, 12)
      .map((it, idx) => {
        let source: string | undefined =
          (it as any).source || it.creator || undefined;

        let link = it.link || it.guid || "#";

        try {
          if (!source && link && link !== "#") {
            const u = new URL(link);
            source = u.hostname.replace(/^www\./, "");
          }
        } catch {}

        const pubDate =
          (it as any).isoDate ||
          (it.pubDate
            ? new Date(it.pubDate).toISOString()
            : undefined);

        return {
          id: it.guid || it.id || `${idx}-${link}`,
          title: it.title || "Untitled",
          link,
          source,
          pubDate,
        };
      });

    setCacheHeaders(res, 600, 300);

    return res.status(200).json({
      updatedAt: Date.now(),
      query,
      items,
    });
  } catch (err: any) {
    console.error("NEWS_API_ERROR:", err?.message || err);

    setCacheHeaders(res, 120, 60);
    return res
      .status(200)
      .json({ updatedAt: Date.now(), query, items: [] });
  }
}