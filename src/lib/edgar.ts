import { fetchSafe } from "@/lib/fetchSafe";

const SEC_HEADERS = {
  "User-Agent": "SignalHub AI (contact: support@yourdomain.com)",
  "Accept-Encoding": "gzip, deflate",
  "Host": "www.sec.gov"
};

export async function fetchEdgarFilings(cik: string) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;

  const res = await fetchSafe(
    url,
    {
      method: "GET",
      headers: SEC_HEADERS,
    },
    8000,
    1
  );

  if (!res.ok) return null;

  try {
    const json = await res.json();
    return json;
  } catch {
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