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
  { actor: "DJT insiders",      cik: CIK.DJT_MEDIA,   ticker: "DJT" },
  { actor: "Dominari insiders", cik: CIK.DOMH,        ticker: "DOMH" },
  { actor: "Hut 8 insiders",    cik: CIK.HUT,         ticker: "HUT" },
  { actor: "Donald Trump Jr.",  cik: CIK.TRUMP_JR,    ticker: "DOMH" },
  { actor: "Eric Trump",        cik: CIK.ERIC_TRUMP,  ticker: "HUT" },
  { actor: "Lara Trump",        cik: CIK.LARA_TRUMP,  ticker: "DJT" },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

// Pak eerste <tag><value>…</value></tag> uit een blok, ook met attributes/namespaces
function firstValueTag(block: string, tag: string): string | null {
  const re = new RegExp(
    `<${tag}\\b[^>]*>[\\s\\S]*?<value\\b[^>]*>([^<]+)<\\/value>`,
    "i"
  );
  const m = block.match(re);
  return m && m[1] ? m[1].trim() : null;
}

// Iets specifiekere helper voor transactionCode (zonder <value>-tag)
function firstSimpleTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([^<]+)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m && m[1] ? m[1].trim() : null;
}

function parseTransactionsFromXml(
  xml: string,
  baseCompany: string,
  ticker: string,
  actor: string
): Trade[] {
  const trades: Trade[] = [];

  // Vind ALLE <nonDerivativeTransaction ...> ... </nonDerivativeTransaction>
  const txRegex =
    /<nonDerivativeTransaction\b[^>]*>([\s\S]*?)<\/nonDerivativeTransaction>/gi;

  let match: RegExpExecArray | null;
  while ((match = txRegex.exec(xml)) !== null) {
    const section = match[1] || "";

    const date =
      firstValueTag(section, "transactionDate") ||
      firstSimpleTag(xml, "periodOfReport") ||
      "";

    const code =
      firstValueTag(section, "transactionAcquiredDisposedCode") || "";

    const sharesStr =
      firstValueTag(section, "transactionShares") || null;

    const priceStr =
      firstValueTag(section, "transactionPricePerShare") || null;

    const transCode =
      firstSimpleTag(section, "transactionCode") || "Form 4";

    const shares = sharesStr
      ? Number(sharesStr.replace(/,/g, ""))
      : null;
    const price = priceStr
      ? Number(priceStr.replace(/,/g, ""))
      : null;

    const value =
      shares != null && price != null
        ? Number((shares * price).toFixed(2))
        : null;

    let type: Trade["type"] = "Other";
    const c = code.toUpperCase();
    if (c === "A") type = "Buy";
    else if (c === "D") type = "Sell";
    else if (c === "G") type = "Grant";

    trades.push({
      actor,
      company: baseCompany,
      ticker,
      date,
      transaction: transCode,
      shares,
      price,
      value,
      type,
    });
  }

  return trades;
}

// Bouw SEC-URL naar de XML van een specifieke filing
function buildXmlUrl(
  cik: string,
  accession: string,
  primaryDoc: string
): string {
  const cleanCik = cik.replace(/^0+/, "");
  const cleanAcc = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAcc}/${primaryDoc}`;
}

async function loadActorTrades(config: ActorConfig): Promise<Trade[]> {
  const filings = await fetchEdgarFilings(config.cik);
  if (!filings?.filings?.recent) return [];

  const recent = filings.filings.recent;
  const trades: Trade[] = [];

  const maxDocs = 10; // max aantal filings per actor dat we inspecteren

  for (let i = 0; i < recent.accessionNumber.length && i < maxDocs; i++) {
    const form = recent.form[i];

    // Alleen echte Form 4 insider transacties meenemen
    if (form !== "4" && form !== "4/A") continue;

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
          ? "Oblong, Inc."
          : config.ticker === "HUT"
          ? "Hut 8 Corp"
          : "Unknown issuer");

      const t = parseTransactionsFromXml(
        xml,
        companyName,
        config.ticker,
        config.actor
      );
      trades.push(...t);
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
    const all: Trade[] = [];

    // Verzamel trades per actor (serieus maar nog steeds seintje voor SEC rate limits)
    for (const cfg of ACTORS) {
      const t = await loadActorTrades(cfg);
      all.push(...t);
    }

    // sorteer op datum, nieuw → oud
    all.sort((a, b) => {
      if (a.date < b.date) return 1;
      if (a.date > b.date) return -1;
      return 0;
    });

    // Hard cap: we houden het overzichtelijk, frontend kan zelf nog slicen
    const limited = all.slice(0, 40);

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=600, stale-while-revalidate=300"
    );

    return res.status(200).json({
      updatedAt: Date.now(),
      trades: limited,
    });
  } catch (err: any) {
    console.error("TRUMP_TRADES_API_ERROR:", err?.message || err);
    return res.status(500).json({ error: "Failed to load EDGAR trades" });
  }
}