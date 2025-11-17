// src/lib/edgar.ts
import { fetchSafe } from "@/lib/fetchSafe";

const SEC_HEADERS = {
  "User-Agent": process.env.SEC_USER_AGENT || "SignalHub AI (contact: support@yourdomain.com)",
  "Accept-Encoding": "gzip, deflate",
  // De Host-header is optioneel; je kunt hem laten staan of weghalen.
  "Host": "www.sec.gov",
};

export async function fetchEdgarFilings(cik: string) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;

  try {
    // fetchSafe gooit zelf een error als de status geen 2xx is,
    // dus als we hier zijn is res.ok al true.
    const res = await fetchSafe(
      url,
      {
        method: "GET",
        headers: SEC_HEADERS,
      },
      8000,
      1
    );

    const json = await res.json();
    return json;
  } catch (err) {
    // Als SEC down is / rate-limit → geen crash, maar gewoon null terug
    console.error("EDGAR fetch error:", err);
    return null;
  }
}

export const CIK = {
  DJT_MEDIA: "0001890671",
  DOMH: "0000746210",
  HUT: "0001959633",
  TRUMP_JR: "0001762074",
  ERIC_TRUMP: "0001952100",
  LARA_TRUMP: "0001952099",
};