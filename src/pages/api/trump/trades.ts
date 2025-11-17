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

type ActorDebug = {
  actor: string;
  cik: string;
  ticker: string;
  filingsCount: number;
  inspected: number;
  forms: string[];
  primaryDocs: string[];
  xmlUrls: string[];
  parsedTrades: number;
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

// Zoek <tag ...><value>xxx</value></tag> (ook met attributes/namespaces)
function firstValueTag(block: string, tag: string): string | null {
  const re = new RegExp(
    `<${tag}\\b[^>]*>[\\s\\S]*?<value\\b[^>]*>([^<]+)<\\/value>`,
    "i"
  );
  const m = block.match(re);
  return m && m[1] ? m[1].trim() : null;
}

// Simpele <tag>xxx</tag>
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

  // Pak zowel nonDerivativeTransaction als derivativeTransaction blokken
  const txRegex =
    /<(nonDerivativeTransaction|derivativeTransaction)\b[^>]*>([\s\S]*?)<\/\1>/gi;

  let match: RegExpExecArray | null;
  while ((match = txRegex.exec(xml)) !== null) {
    const section = match[2] || "";

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

async function loadActorTrades(
  config: ActorConfig,
  withDebug: boolean
): Promise<{ trades: Trade[]; debug: ActorDebug | null }> {
  const filings = await fetchEdgarFilings(config.cik);
  if (!filings?.filings?.recent) {
    return {
      trades: [],
      debug: withDebug
        ? {
            actor: config.actor,
            cik: config.cik,
            ticker: config.ticker,
            filingsCount: 0,
            inspected: 0,
            forms: [],
            primaryDocs: [],
            xmlUrls: [],
            parsedTrades: 0,
          }
        : null,
    };
  }

  const recent = filings.filings.recent;
  const trades: Trade[] = [];
  const maxDocs = 10; // max filings per actor

  const forms: string[] = [];
  const primaryDocs: string[] = [];
  const xmlUrls: string[] = [];

  let inspected = 0;

  for (let i = 0; i < recent.accessionNumber.length && i < maxDocs; i++) {
    const form = recent.form[i];
    const primaryDoc = recent.primaryDocument[i];

    // Alleen echte insider-transacties: Form 4 / 4/A
    if (form !== "4" && form !== "4/A") continue;
    if (!primaryDoc) continue;

    inspected++;
    forms.push(form);
    primaryDocs.push(primaryDoc);

    const accession = recent.accessionNumber[i];
    const xmlUrl = buildXmlUrl(config.cik, accession, primaryDoc);
    xmlUrls.push(xmlUrl);

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

  const debug: ActorDebug | null = withDebug
    ? {
        actor: config.actor,
        cik: config.cik,
        ticker: config.ticker,
        filingsCount: recent.accessionNumber.length,
        inspected,
        forms,
        primaryDocs,
        xmlUrls,
        parsedTrades: trades.length,
      }
    : null;

  return { trades, debug };
}

// ─────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TradesResponse | { error: string } | any>
) {
  const wantDebug = req.query.debug === "1";

  try {
    const all: Trade[] = [];
    const debugInfo: ActorDebug[] = [];

    for (const cfg of ACTORS) {
      const { trades, debug } = await loadActorTrades(cfg, wantDebug);
      all.push(...trades);
      if (debug) debugInfo.push(debug);
    }

    // sorteer op datum, nieuw → oud
    all.sort((a, b) => {
      if (a.date < b.date) return 1;
      if (a.date > b.date) return -1;
      return 0;
    });

    const limited = all.slice(0, 40);

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=600, stale-while-revalidate=300"
    );

    const body: any = {
      updatedAt: Date.now(),
      trades: limited,
    };
    if (wantDebug) body.debug = debugInfo;

    return res.status(200).json(body);
  } catch (err: any) {
    console.error("TRUMP_TRADES_API_ERROR:", err?.message || err);
    return res.status(500).json({ error: "Failed to load EDGAR trades" });
  }
}