// src/pages/api/trump/trades.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { fetchSafe } from "@/lib/fetchSafe";
import { fetchEdgarFilings, CIK } from "@/lib/edgar";

type Trade = {
  actor: string;
  company: string;
  ticker: string;
  date: string;
  transaction: string;
  shares: number | null;
  price: number | null;
  value: number | null;
  type: "Buy" | "Sell" | "Grant" | "Other";
};

type TradesResponse = {
  updatedAt: number;
  trades: Trade[];
};

type ActorConfig = {
  actor: string;
  cik: string;
  ticker: string;
};

// Mapping van personen/bedrijven naar CIK + ticker
const ACTORS: ActorConfig[] = [
  { actor: "DJT insiders",     cik: CIK.DJT_MEDIA,    ticker: "DJT" },
  { actor: "Dominari insiders",cik: CIK.DOMH,        ticker: "DOMH" },
  { actor: "Hut 8 insiders",   cik: CIK.HUT,         ticker: "HUT" },
  { actor: "Donald Trump Jr.", cik: CIK.TRUMP_JR,    ticker: "DOMH" },
  { actor: "Eric Trump",       cik: CIK.ERIC_TRUMP,  ticker: "HUT" },
  { actor: "Lara Trump",       cik: CIK.LARA_TRUMP,  ticker: "DJT" },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function firstMatch(xml: string, regex: RegExp): string | null {
  const m = xml.match(regex);
  return m && m[1] ? m[1].trim() : null;
}

/**
 * Parse zowel non-derivative als derivative transacties uit een Form 4 XML.
 * Simpele regex-aanpak, geen extra dependencies.
 */
function parseTransactionsFromXml(
  xml: string,
  baseCompany: string,
  ticker: string,
  actor: string
): Trade[] {
  const trades: Trade[] = [];

  const nonDerivBlocks = Array.from(
    xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)
  );
  const derivBlocks = Array.from(
    xml.matchAll(/<derivativeTransaction>([\s\S]*?)<\/derivativeTransaction>/gi)
  );

  const blocks = [...nonDerivBlocks, ...derivBlocks];

  // Fallback datum op basis van periodOfReport
  const fallbackDate =
    firstMatch(xml, /<periodOfReport>([^<]+)<\/periodOfReport>/i) || "";

  for (const m of blocks) {
    const section = m[1] || "";

    const date =
      firstMatch(
        section,
        /<transactionDate>[\s\S]*?<value>([^<]+)<\/value>/i
      ) || fallbackDate;

    // A / D / G / P / S etc.
    const acquiredDisposed =
      firstMatch(
        section,
        /<transactionAcquiredDisposedCode>[\s\S]*?<value>([^<]+)<\/value>/i
      ) || "";

    const transCode =
      firstMatch(section, /<transactionCode>([^<]+)<\/transactionCode>/i) || "";

    const sharesStr =
      firstMatch(
        section,
        /<transactionShares>[\s\S]*?<value>([^<]+)<\/value>/i
      ) ||
      firstMatch(
        section,
        /<sharesOwnedFollowingTransaction>[\s\S]*?<value>([^<]+)<\/value>/i
      ) ||
      null;

    const priceStr =
      firstMatch(
        section,
        /<transactionPricePerShare>[\s\S]*?<value>([^<]+)<\/value>/i
      ) ||
      firstMatch(
        section,
        /<conversionOrExercisePrice>[\s\S]*?<value>([^<]+)<\/value>/i
      ) ||
      null;

    const description =
      firstMatch(
        section,
        /<transactionDescription>([^<]+)<\/transactionDescription>/i
      ) ||
      (transCode
        ? `Form 4 transaction (${transCode})`
        : "Form 4 transaction");

    const shares = sharesStr ? Number(sharesStr.replace(/,/g, "")) : null;
    const price = priceStr ? Number(priceStr.replace(/,/g, "")) : null;
    const value =
      shares != null && price != null
        ? Number((shares * price).toFixed(2))
        : null;

    // Als er echt niets bruikbaars is, overslaan
    if (!date && shares == null && price == null) continue;

    let type: Trade["type"] = "Other";
    const code = (acquiredDisposed || transCode).toUpperCase();

    // A / P = acquisition (buy), D / S = disposal (sell)
    if (code === "A" || code === "P") type = "Buy";
    else if (code === "D" || code === "S") type = "Sell";
    else if (code === "G") type = "Grant";

    trades.push({
      actor,
      company: baseCompany,
      ticker,
      date,
      transaction: description,
      shares,
      price,
      value,
      type,
    });
  }

  return trades;
}

// Bouw SEC-URL naar de XML van een specifieke filing
function buildXmlUrl(cik: string, accession: string, primaryDoc: string): string {
  const cleanCik = cik.replace(/^0+/, "");
  const cleanAcc = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAcc}/${primaryDoc}`;
}

async function loadActorTrades(config: ActorConfig): Promise<Trade[]> {
  const filings = await fetchEdgarFilings(config.cik);
  if (!filings?.filings?.recent) return [];

  const recent = filings.filings.recent;

  const trades: Trade[] = [];
  const maxDocs = 8; // limiter per actor

  for (let i = 0; i < recent.accessionNumber.length && i < maxDocs; i++) {
    const form = recent.form[i];
    if (form !== "4") continue; // alleen Form 4

    const accession = recent.accessionNumber[i];
    const primaryDoc = recent.primaryDocument[i];
    if (!primaryDoc) continue;

    const xmlUrl = buildXmlUrl(config.cik, accession, primaryDoc);

    try {
      const res = await fetchSafe(
        xmlUrl,
        {
          method: "GET",
          headers: {
            "User-Agent":
              process.env.SEC_USER_AGENT ||
              "SignalHub AI (contact: support@signalhub.tech)",
            "Accept-Encoding": "gzip, deflate",
          },
        },
        8000,
        0
      );
      if (!res.ok) continue;

      const xml = await res.text();
      const companyName =
        filings?.name ||
        (config.ticker === "DJT"
          ? "Trump Media & Technology Group"
          : config.ticker === "DOMH"
          ? "Dominari Holdings"
          : config.ticker === "HUT"
          ? "Hut 8 Corp"
          : "Unknown issuer");

      const parsed = parseTransactionsFromXml(
        xml,
        companyName,
        config.ticker,
        config.actor
      );
      trades.push(...parsed);
    } catch (err) {
      console.error("Error fetching Form 4 XML", xmlUrl, err);
      continue;
    }
  }

  return trades;
}

// ─────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TradesResponse | { error: string }>
) {
  try {
    // Parallel ophalen; één mislukte actor breekt de rest niet
    const results = await Promise.allSettled(
      ACTORS.map((cfg) => loadActorTrades(cfg))
    );

    const all: Trade[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        all.push(...r.value);
      } else {
        console.error("TRUMP_TRADES_ACTOR_ERROR:", r.reason);
      }
    }

    // sorteer op datum, nieuw → oud
    all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=600, stale-while-revalidate=300"
    );

    return res.status(200).json({
      updatedAt: Date.now(),
      trades: all,
    });
  } catch (err: any) {
    console.error("TRUMP_TRADES_API_ERROR:", err?.message || err);
    return res.status(500).json({ error: "Failed to load EDGAR trades" });
  }
}