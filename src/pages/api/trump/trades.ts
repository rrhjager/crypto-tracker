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

/**
 * scope:
 * - "issuer"  => CIK is een bedrijf (DOMH, DJT, HUT, DWAC). We zoeken echte Form 4 trades.
 * - "person"  => CIK is een persoon / trust. We nemen Form 4 + D/D-A + 13D/13G (disclosures).
 */
type ActorConfig = {
  actor: string;
  cik: string;
  ticker: string;
  scope: "issuer" | "person";
  /** Welke forms tellen mee voor deze actor (prefix-match) */
  allowedForms?: string[];
};

// ─────────────────────────────────────────────────────────────
// Actor mapping – 10 belangrijkste Trump-links
// ─────────────────────────────────────────────────────────────

const ACTORS: ActorConfig[] = [
  // Company / issuer level
  { actor: "DJT Media insiders", cik: CIK.DJT_MEDIA, ticker: "DJT", scope: "issuer" },
  { actor: "Dominari insiders",  cik: CIK.DOMH,      ticker: "DOMH", scope: "issuer" },
  { actor: "Hut 8 insiders",     cik: CIK.HUT,       ticker: "HUT",  scope: "issuer" },
  // DWAC SPAC (pre-DJT listing)
  { actor: "DWAC SPAC insiders", cik: "0001849635",  ticker: "DWAC", scope: "issuer" },

  // Person / trust level (Trump family & trust)
  // Donald J. Trump – persoonlijke CIK (oude Form-4’s / 13D/13G etc.)
  { actor: "Donald J. Trump",    cik: "0000947033",  ticker: "DJT",  scope: "person" },
  // Melania heeft in de praktijk nauwelijks / geen eigen SEC-filings; toch meenemen voor als ze ooit verschijnt.
  { actor: "Melania Trump",      cik: "0001681540",  ticker: "DJT",  scope: "person" },
  // Donald Jr – persoonlijke CIK (PSQH / DOMH / etc.)
  { actor: "Donald Trump Jr.",   cik: CIK.TRUMP_JR,  ticker: "DOMH", scope: "person" },
  // Eric – Hut 8 / andere disclosures
  { actor: "Eric Trump",         cik: CIK.ERIC_TRUMP, ticker: "HUT", scope: "person" },
  // Ivanka – eigen historische Form-4 / 13D/13G
  { actor: "Ivanka Trump",       cik: "0001406847",  ticker: "DJT",  scope: "person" },
  // Jared Kushner – QXO director; filings op zijn eigen CIK
  { actor: "Jared Kushner",      cik: "0001614323",  ticker: "QXO",  scope: "person" },
  // Lara – DJT / HUT disclosures
  { actor: "Lara Trump",         cik: CIK.LARA_TRUMP, ticker: "DJT", scope: "person" },
  // DJT Revocable Trust – grote Trump-holding
  { actor: "DJT Revocable Trust", cik: "0001345263", ticker: "DJT",  scope: "person" },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function firstMatch(xml: string, regex: RegExp): string | null {
  const m = xml.match(regex);
  return m && m[1] ? m[1].trim() : null;
}

/**
 * Parser voor echte Form-4 XML (nonDerivativeTransaction)
 * plus fallback op COMMON STOCK-regels in xslF345X05 HTML.
 */
function parseTransactionsFromXml(
  xml: string,
  baseCompany: string,
  ticker: string,
  actor: string
): Trade[] {
  const trades: Trade[] = [];

  // 1) Echte XML <nonDerivativeTransaction> blocks
  if (/<nonDerivativeTransaction>/i.test(xml)) {
    const blocks = xml.split(/<nonDerivativeTransaction>/i).slice(1);
    for (const block of blocks) {
      const section = block.split(/<\/nonDerivativeTransaction>/i)[0] || "";

      const date =
        firstMatch(
          section,
          /<transactionDate>[\s\S]*?<value>([^<]+)<\/value>/i
        ) ||
        firstMatch(xml, /<periodOfReport>([^<]+)<\/periodOfReport>/i) ||
        "";

      const adCode =
        firstMatch(
          section,
          /<transactionAcquiredDisposedCode>[\s\S]*?<value>([^<]+)<\/value>/i
        ) || "";

      const transCode =
        firstMatch(
          section,
          /<transactionCoding>[\s\S]*?<transactionCode>([^<]+)<\/transactionCode>/i
        ) || "";

      const sharesStr =
        firstMatch(
          section,
          /<transactionShares>[\s\S]*?<value>([^<]+)<\/value>/i
        ) || null;

      const priceStr =
        firstMatch(
          section,
          /<transactionPricePerShare>[\s\S]*?<value>([^<]+)<\/value>/i
        ) || null;

      const shares = sharesStr ? Number(sharesStr.replace(/,/g, "")) : null;
      const price = priceStr ? Number(priceStr.replace(/,/g, "")) : null;
      const value =
        shares != null && price != null
          ? Number((shares * price).toFixed(2))
          : null;

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

  // 2) Fallback: xslF345X05 HTML → COMMON STOCK regels
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
      shares != null && price != null
        ? Number((shares * price).toFixed(2))
        : null;

    let type: Trade["type"] = "Other";
    const flag = (adFlag || "").toUpperCase();
    if (flag === "A") type = "Buy";
    else if (flag === "D") type = "Sell";

    const transaction = `Form 4: ${transCode} (${flag || "-"})`;

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

  // Duplicaten eruit
  const dedupKey = (t: Trade) =>
    [
      t.actor,
      t.company,
      t.ticker,
      t.date,
      t.transaction,
      t.shares ?? "-",
      t.price ?? "-",
    ].join("|");

  const seen = new Set<string>();
  const unique: Trade[] = [];
  for (const t of trades) {
    const key = dedupKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }

  return unique;
}

function buildXmlUrl(cik: string, accession: string, primaryDoc: string): string {
  const cleanCik = cik.replace(/^0+/, "");
  const cleanAcc = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAcc}/${primaryDoc}`;
}

/**
 * Maak een “disclosure event” trade voor niet-Form-4 filings
 * (Form D / SC 13D / SC 13G etc.) – geen exacte aantallen/prijs.
 */
function buildDisclosureTrade(
  cfg: ActorConfig,
  filingDate: string | undefined,
  form: string,
  companyName: string
): Trade {
  const label =
    form.startsWith("D")
      ? `Form ${form} (private placement / exempt offering)`
      : `Ownership disclosure (${form})`;

  return {
    actor: cfg.actor,
    company: companyName,
    ticker: cfg.ticker,
    date: filingDate || "",
    transaction: label,
    shares: null,
    price: null,
    value: null,
    type: "Other",
  };
}

// ─────────────────────────────────────────────────────────────
// Core loader per actor
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

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  // default: alleen Form 4, voor issuers
  const allowedForms = config.allowedForms ?? (
    config.scope === "issuer"
      ? ["4"]
      : ["4", "D", "D/A", "SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A"]
  );

  const MAX_RELEVANT_PER_ACTOR = 60;
  let relevantCount = 0;

  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const form = recent.form[i];
    const upperForm = form.toUpperCase();

    const isAllowed = allowedForms.some((prefix) =>
      upperForm.startsWith(prefix.toUpperCase())
    );
    if (!isAllowed) continue;

    const filingDateStr = recent.filingDate?.[i];
    if (filingDateStr) {
      const dt = new Date(filingDateStr);
      if (!Number.isNaN(dt.getTime()) && dt < sixMonthsAgo) {
        // newest-first; zodra we buiten 6 maanden vallen kunnen we stoppen
        break;
      }
    }

    inspected++;
    relevantCount++;
    if (relevantCount > MAX_RELEVANT_PER_ACTOR) break;

    const accession = recent.accessionNumber[i];
    const primaryDoc = recent.primaryDocument[i] || "";
    const xmlUrl = primaryDoc
      ? buildXmlUrl(config.cik, accession, primaryDoc)
      : "";

    forms.push(form);
    primaryDocs.push(primaryDoc);
    if (xmlUrl) xmlUrls.push(xmlUrl);

    const companyName =
      filings?.name ||
      (config.ticker === "DJT"
        ? "Trump Media & Technology Group"
        : config.ticker === "DOMH"
        ? "Oblong, Inc."
        : config.ticker === "HUT"
        ? "Hut 8 Corp"
        : config.ticker === "DWAC"
        ? "Digital World Acquisition Corp."
        : config.ticker === "QXO"
        ? "QXO, Inc."
        : "Unknown issuer");

    // Form 4 → probeer echte trades te parsen
    if (upperForm.startsWith("4") && xmlUrl) {
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
    } else {
      // Niet-Form-4 maar wél relevant (Form D / 13D/13G)
      trades.push(
        buildDisclosureTrade(config, filingDateStr, upperForm, companyName)
      );
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
    const withDebug =
      req.query.debug === "1" || req.query.debug === "true";

    const all: Trade[] = [];
    const debugActors: DebugActor[] = [];

    for (const cfg of ACTORS) {
      const t = await loadActorTrades(cfg, withDebug ? debugActors : undefined);
      all.push(...t);
    }

    // sorteer op datum, nieuw → oud
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

    const payload: TradesResponse = {
      updatedAt: Date.now(),
      trades: all,
      ...(withDebug ? { debug: debugActors } : {}),
    };

    return res.status(200).json(payload);
  } catch (err: any) {
    console.error("TRUMP_TRADES_API_ERROR:", err?.message || err);
    return res.status(500).json({ error: "Failed to load EDGAR trades" });
  }
}