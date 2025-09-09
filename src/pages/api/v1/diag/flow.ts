// src/pages/api/v1/diag/flow.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { whaleFlow24hUSD } from "@/lib/providers/flow";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const slug = String(Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug || "").trim();

  // debug: standaard “aan” (zoals je had met "1")
  const rawDebug = Array.isArray(req.query.debug) ? req.query.debug[0] : req.query.debug;
  const debugStr = String(rawDebug ?? "1").toLowerCase();
  const debug = debugStr === "1" || debugStr === "true" || debugStr === "yes";

  // optioneel: delayDays doorgeven als getal als die is meegegeven
  const rawDelay = Array.isArray(req.query.delayDays) ? req.query.delayDays[0] : req.query.delayDays;
  const nDelay = Number(rawDelay);
  const delayDays = Number.isFinite(nDelay) ? nDelay : undefined;

  if (!slug) {
    return res.status(400).json({ error: "Missing ?slug=<santiment-slug>, bv: bitcoin, ethereum, solana" });
  }

  try {
    // ✅ geef een options object i.p.v. een boolean
    const out = await whaleFlow24hUSD(slug, { debug, delayDays });
    res.status(200).json({
      ok: true,
      slug,
      ...out, // inflowUSD/outflowUSD/netUSD/score/direction/used
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, slug, error: e?.message || String(e) });
  }
}