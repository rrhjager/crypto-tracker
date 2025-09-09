import type { NextApiRequest, NextApiResponse } from "next";
import { whaleFlow24hUSD } from "@/lib/providers/flow";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const slug = String(req.query.slug || "").trim();
  const debug = String(req.query.debug || "1").toLowerCase() !== "0";

  if (!slug) {
    return res.status(400).json({ error: "Missing ?slug=<santiment-slug>, bv: bitcoin, ethereum, solana" });
  }

  try {
    const out = await whaleFlow24hUSD(slug, debug);
    res.status(200).json({
      ok: true,
      slug,
      ...out,            // inflowUSD/outflowUSD/netUSD/score/direction/used
    });
  } catch (e: any) {
    res.status(500).json({ ok:false, slug, error: e?.message || String(e) });
  }
}