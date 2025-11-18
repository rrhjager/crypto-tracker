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

type DebugActor = {
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

type TradesResponse = {
  updatedAt: number;
  trades: Trade[];
  debug?: DebugActor[];
};

type ActorConfig = {
  actor: string;
  cik: string;
  ticker: string;
};

// ─────────────────────────────────────────────────────────────
// Trump universe (top 10 belangrijkste personen & bedrijven)
// ─────────────────────────────────────────────────────────────

// Extra personen & bedrijven met confirmed CIKs
const ACTORS: ActorConfig[] = [
  // ─── Trump bedrijven ───────────────────────────────────────
  { actor: "TMTG (DJT Media)", cik: CIK.DJT_MEDIA, ticker: "DJT" },
  { actor: "DWAC / SPAC insiders", cik: "0001849635", ticker: "DWAC" },
  { actor: "Trump Org / DJT Trust", cik: "0001960155", ticker: "N/A" },

  // ─── Trump familie ─────────────────────────────────────────
  { actor: "Donald J. Trump", cik: "0001960152", ticker: "N/A" },
  { actor: "Melania Trump", cik: "0001960153", ticker: "N/A" },
  { actor: "Donald Trump Jr.", cik: CIK.TRUMP_JR, ticker: "N/A" },
  { actor: "Eric Trump", cik: CIK.ERIC_TRUMP, ticker: "N/A" },
  { actor: "Ivanka Trump", cik: "0001672491", ticker: "N/A" },
  { actor: "Jared Kushner", cik: "0001614217", ticker: "N/A" },
  { actor: "Lara Trump", cik: CIK.LARA_TRUMP, ticker: "N/A" },

  // ─── Bestaande bedrijven die al trades gaven ───────────────
  { actor: "Dominari insiders", cik: CIK.DOMH, ticker: "DOMH" },
  { actor: "Hut 8 insiders", cik: CIK.HUT, ticker: "HUT" },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function firstMatch(xml: string, regex: RegExp): string | null {
  const m = xml.match(regex);
  return m && m[1] ? m[1].trim() : null;
}

function parseTransactionsFromXml(
  xml: string,
  baseCompany: string,
  ticker: string,
  actor: string
): Trade[] {
  const trades: Trade[] = [];

  // ─── 1) Oude XML structuur ─────────────────────────────────
  if (/<nonDerivativeTransaction>/i.test(xml)) {
    const blocks = xml.split(/<nonDerivativeTransaction>/i).slice(1);

    for (const block of blocks) {
      const section = block.split(/<\/nonDerivativeTransaction>/i)[0] || "";

      const date =
        firstMatch(section, /<transactionDate>[\s\S]*?<value>([^<]+)<\/value>/i) ||
        firstMatch(xml, /<periodOfReport>([^<]+)<\/periodOfReport>/i) ||
        "";

      const adCode =
        firstMatch(section, /<transactionAcquiredDisposedCode>[\s\S]*?<value>([^<]+)<\/value>/i) ||
        "";

      const transCode =
        firstMatch(section, /<transactionCoding>[\s\S]*?<transactionCode>([^<]+)<\/transactionCode>/i) ||
        "";

      const sharesStr =
        firstMatch(section, /<transactionShares>[\s\S]*?<value>([^<]+)<\/value>/i) ||
        null;

      const priceStr =
        firstMatch(section, /<transactionPricePerShare>[\s\S]*?<value>([^<]+)<\/value>/i) ||
        null;

      const shares = sharesStr ? Number(sharesStr.replace(/,/g, "")) : null;
      const price = priceStr ? Number(priceStr.replace(/,/g, "")) : null;
      const value =
        shares != null && price != null ? Number((shares * price).toFixed(2)) : null;

      let type: Trade["type"] = "Other";
      const flag = adCode.toUpperCase();

      if (flag === "A") type = "Buy";
      else if (flag === "D") type = "Sell";
      else if (transCode.toUpperCase() === "G") type = "Grant";

      const transaction =
        transCode || adCode
          ? `Form 4: ${transCode || adCode} (${flag || "-"})`
          : "Form 4 transaction";

      trades.push({
        actor,
        company: baseCompany,
        ticker,
        date,
        transaction,
        shares,
        price,
        value,
        type,
      });
    }

    if (trades.length > 0) return trades;
  }

  // ─── 2) Fallback parser voor HTML-layout ────────────────────
  const text = xml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  const COMMON_ROW_REGEX =
    /COMMON STOCK\s+(\d{2}\/\d{2}\/\d{4})\s+([A-Z]{1,2})\s+([\d,]+)\s+([AD])(?:\s+\$?\s*([\d.]+))?/gi;

  let m: RegExpExecArray | null;

  while ((m = COMMON_ROW_REGEX.exec(text)) !== null) {
    const [, date, transCode, sharesStr, adFlag, priceStr] = m;

    const shares = sharesStr ? Number(sharesStr.replace(/,/g, "")) : null;
    const price = priceStr ? Number(priceStr) : null;
    const value =
      shares != null && price != null ? Number((shares * price).toFixed(2)) : null;

    let type: Trade["type"] = "Other";
    const flag = adFlag.toUpperCase();

    if (flag === "A") type = "Buy";
    else if (flag === "D") type = "Sell";

    trades.push({
      actor,
      company: baseCompany,
      ticker,
      date,
      transaction: `Form 4: ${transCode} (${flag})`,
      shares,
      price,
      value,
      type,
    });
  }

  // ─── Deduplicatie ───────────────────────────────────────────
  const seen = new Set<string>();
  const unique: Trade[] = [];

  for (const t of trades) {
    const key = [
      t.actor,
      t.company,
      t.ticker,
      t.date,
      t.transaction,
      t.shares ?? "-",
      t.price ?? "-",
    ].join("|");

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(t);
    }
  }

  return unique;
}

function buildXmlUrl(cik: string, accession: string, primaryDoc: string): string {
  const cleanCik = cik.replace(/^0+/, "");
  const cleanAcc = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAcc}/${primaryDoc}`;
}

// ─────────────────────────────────────────────────────────────
// Haal ALLE Form-4’s op van laatste 12 maanden
// ─────────────────────────────────────────────────────────────
async function loadActorTrades(
  config: ActorConfig,
  debugCollector?: DebugActor[]
): Promise<Trade[]> {
  const filings = await fetchEdgarFilings(config.cik);
  if (!filings?.filings?.recent) return [];

  const recent = filings.filings.recent;
  const trades: Trade[] = [];

  const forms: string[] = [];
  const primaryDocs: string[] = [];
  const xmlUrls: string[] = [];
  let inspected = 0;

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const MAX_FORM4_PER_ACTOR = 80;
  let form4Count = 0;

  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const form = recent.form[i];
    if (form !== "4") continue;

    const filingDateStr = recent.filingDate?.[i];
    if (filingDateStr) {
      const dt = new Date(filingDateStr);
      if (!Number.isNaN(dt.getTime()) && dt < oneYearAgo) break;
    }

    inspected++;
    form4Count++;
    if (form4Count > MAX_FORM4_PER_ACTOR) break;

    const accession = recent.accessionNumber[i];
    const primaryDoc = recent.primaryDocument[i];
    if (!primaryDoc) continue;

    const xmlUrl = buildXmlUrl(config.cik, accession, primaryDoc);
    forms.push(form);
    primaryDocs.push(primaryDoc);
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
        config.ticker ||
        "Unknown issuer";

      const parsed = parseTransactionsFromXml(
        xml,
        companyName,
        config.ticker,
        config.actor
      );

      trades.push(...parsed);
    } catch (err) {
      console.error("Error fetching Form 4 XML/HTML", xmlUrl, err);
      continue;
    }
  }

  if (debugCollector) {
    debugCollector.push({
      actor: config.actor,
      cik: config.cik,
      ticker: config.ticker,
      filingsCount: recent.accessionNumber.length,
      inspected,
      forms,
      primaryDocs,
      xmlUrls,
      parsedTrades: trades.length,
    });
  }

  return trades;
}

// ─────────────────────────────────────────────────────────────
// API handler
// ─────────────────────────────────────────────────────────────
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TradesResponse | { error: string }>
) {
  try {
    const withDebug = req.query.debug === "1" || req.query.debug === "true";

    const all: Trade[] = [];
    const debugActors: DebugActor[] = [];

    for (const cfg of ACTORS) {
      const t = await loadActorTrades(cfg, withDebug ? debugActors : undefined);
      all.push(...t);
    }

    all.sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();

      if (Number.isNaN(da) || Number.isNaN(db)) {
        return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
      }

      return db - da;
    });

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=600, stale-while-revalidate=300"
    );

    return res.status(200).json({
      updatedAt: Date.now(),
      trades: all,
      ...(withDebug ? { debug: debugActors } : {}),
    });
  } catch (err: any) {
    console.error("TRUMP_TRADES_API_ERROR:", err);
    return res.status(500).json({ error: "Failed to load EDGAR trades" });
  }
}