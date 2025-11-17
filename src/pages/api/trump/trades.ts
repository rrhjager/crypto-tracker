import type { NextApiRequest, NextApiResponse } from "next";
import { fetchEdgarFilings, CIK } from "@/lib/edgar";

type Trade = {
  actor: string;
  company: string;
  ticker: string;
  date: string;
  transaction: string;
  shares: number | null;
  price: number | null;
  type: "Buy" | "Sell" | "Grant" | "Other";
};

function extractTrades(filings: any, actor: string, ticker: string): Trade[] {
  if (!filings?.filings?.recent) return [];

  const { filings: { recent } } = filings;
  const trades: Trade[] = [];

  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const form = recent.form[i];
    if (form !== "4") continue; // only insider forms

    const date = recent.filingDate[i];
    const desc = recent.primaryDocDescription[i] || "";
    const trans = desc.toLowerCase();

    let type: Trade["type"] = "Other";
    if (trans.includes("sale")) type = "Sell";
    if (trans.includes("purchase")) type = "Buy";
    if (trans.includes("award") || trans.includes("grant")) type = "Grant";

    trades.push({
      actor,
      company: ticker === "DJT" ? "Trump Media & Technology Group" :
               ticker === "DOMH" ? "Dominari Holdings" :
               ticker === "HUT" ? "Hut 8 Corp" : "Unknown",
      ticker,
      date,
      transaction: desc || "Form 4 filing",
      shares: null, // we can parse XML later
      price: null,
      type,
    });
  }

  return trades;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const actors = [
      { actor: "Trump Jr.", cik: CIK.TRUMP_JR, ticker: "DOMH" },
      { actor: "Eric Trump", cik: CIK.ERIC_TRUMP, ticker: "HUT" },
      { actor: "Lara Trump", cik: CIK.LARA_TRUMP, ticker: "DJT" },
      { actor: "DJT insiders", cik: CIK.DJT_MEDIA, ticker: "DJT" },
      { actor: "DOMH insiders", cik: CIK.DOMH, ticker: "DOMH" },
      { actor: "HUT insiders", cik: CIK.HUT, ticker: "HUT" },
    ];

    const allTrades: Trade[] = [];

    for (const a of actors) {
      const filings = await fetchEdgarFilings(a.cik);
      if (!filings) continue;
      const trades = extractTrades(filings, a.actor, a.ticker);
      allTrades.push(...trades);
    }

    allTrades.sort((a, b) => (a.date < b.date ? 1 : -1));

    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=300");

    return res.status(200).json({
      updatedAt: Date.now(),
      trades: allTrades,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}