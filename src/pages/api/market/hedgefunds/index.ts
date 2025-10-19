import type { NextApiRequest, NextApiResponse } from 'next'
import { XMLParser } from 'fast-xml-parser'
import { kvRefreshIfStale, kvSetJSON } from '@/lib/kv'

export const config = { runtime: 'nodejs' }

/* ---------------- types ---------------- */
type Holding = {
  issuer: string
  symbol: string | null
  valueUSD: number | null
  shares: number | null
  class?: string | null
  cusip?: string | null
}
type FundOut = {
  fund: string
  cik?: string | null
  asOf?: string | null
  filingUrl?: string | null
  holdings: Holding[]
  error?: string
  _source?: 'submissions'
}

/* -------------- funds -------------- */
const FUNDS: { name: string; cik: string }[] = [
  { name: 'Berkshire Hathaway',        cik: '0001067983' },
  { name: 'Bridgewater Associates',    cik: '0001350694' },
  { name: 'Renaissance Technologies',  cik: '0001037389' },
  { name: 'Citadel Advisors',          cik: '0001423053' },
  { name: 'D. E. Shaw & Co.',          cik: '0001009207' },
  { name: 'Lone Pine Capital',         cik: '0001061163' },
  { name: 'Tiger Global Management',   cik: '0001167483' },
  { name: 'Greenlight Capital',        cik: '0001079114' },
  { name: 'Soros Fund Management',     cik: '0001029160' },
  { name: 'Balyasny Asset Management', cik: '0001218710' },
]

/* -------------- perf & cache config -------------- */
// Edge CDN: meeste hits raken je functie niet
const EDGE_S_MAXAGE   = 900;   // 15 min
const EDGE_SWR        = 3600;  // 60 min
// KV snapshot: 60 min geldig; 5 min ervoor in bg verversen
const KV_TTL_SEC      = 3600;  // 60 min
const KV_REVALIDATE   = 300;   // 5 min
// SEC beleefdheidsinstellingen
const UA    = process.env.SEC_USER_AGENT || 'SignalHub/1.0 (contact: you@example.com)'
const DELAY = Math.max(0, Number(process.env.SEC_FETCH_DELAY_MS || 500))
// Bounded concurrency voor fonds-queue
const WORKERS = 2

const sleep = (ms:number)=> new Promise(r=>setTimeout(r,ms))

async function httpGet(url: string, init?: RequestInit, retries = 2): Promise<Response> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: {
        'user-agent': UA,
        'accept': 'text/html,application/xhtml+xml,application/xml,application/atom+xml,application/json;q=0.9,*/*;q=0.8',
        ...(init?.headers || {}),
      },
      cache: 'no-store',
    })
    if (r.status === 429 && retries > 0) {
      await sleep(1200)
      return httpGet(url, init, retries - 1)
    }
    return r
  } catch {
    if (retries > 0) {
      await sleep(800)
      return httpGet(url, init, retries - 1)
    }
    return new Response(null, { status: 520 })
  }
}

/* -------------- SEC helpers -------------- */
const padCIK = (cik:string)=> cik.replace(/\D/g,'').padStart(10,'0')

async function secJson(url:string){
  const r = await httpGet(url, { headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`)
  return r.json()
}
async function secText(url:string){
  const r = await httpGet(url)
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`)
  return r.text()
}

async function pickLatest13F(cikRaw:string){
  const cik = padCIK(cikRaw)
  const j = await secJson(`https://data.sec.gov/submissions/CIK${cik}.json`)
  const rec = j?.filings?.recent
  if (!rec) throw new Error('no recent filings')
  for (let i=0;i<rec.form.length;i++){
    const form = String(rec.form[i]||'')
    if (!/^13F-HR/i.test(form)) continue
    const accession = String(rec.accessionNumber[i]||'').replace(/-/g,'')
    const reportDate = String(rec.reportDate?.[i] || rec.filingDate?.[i] || '')
    const filingHref = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/`
    return { cik, accession, reportDate, filingHref }
  }
  throw new Error('no 13F-HR filing')
}

async function listInfoTableFiles(cik:string, acc:string){
  const j = await secJson(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/index.json`)
  const items: Array<{name:string,type?:string}> = j?.directory?.item || []
  const scored = items
    .filter(f => /\.(xml|txt|htm|html)$/i.test(f.name))
    .map(f => {
      const n = f.name.toLowerCase()
      let score = 0
      if (/(informationtable|info[-_]?table)/.test(n)) score += 100
      if (/form13f/.test(n)) score += 40
      if (/13f/.test(n)) score += 20
      if (n.endsWith('.xml')) score += 10
      if (n.endsWith('.txt')) score += 5
      if (String(f.type||'').toLowerCase().includes('information table')) score += 120
      return { name: f.name, score }
    })
    .sort((a,b)=> b.score - a.score)
  return scored.map(s => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${s.name}`)
}

function parseInfoTable(fileText: string): Holding[] {
  let xml = fileText
  if (!/<informationTable[\s>]/i.test(xml)) {
    const m = fileText.match(/<informationTable[\s\S]*<\/informationTable>/i)
    if (m) xml = m[0]
  }

  const rows: Holding[] = []
  try {
    const parser = new XMLParser({ ignoreAttributes:false, attributeNamePrefix:'', allowBooleanAttributes:true })
    const j: any = parser.parse(xml)

    const buckets: any[] = []
    const pushIf = (x:any)=> { if (x) buckets.push(x) }
    pushIf(j?.informationTable?.infoTable)
    pushIf(j?.form13FInformationTable?.infoTable)

    const sweep = (x:any)=>{
      if (!x || typeof x!=='object') return
      if (Array.isArray(x)) return x.forEach(sweep)
      if (x.nameOfIssuer || x.nameofissuer) buckets.push([x])
      Object.values(x).forEach(sweep)
    }
    if (!buckets.length) sweep(j)

    const toNum = (v:any)=> {
      const s = String(v??'').replace(/[, ]+/g,''); const f = parseFloat(s)
      return Number.isFinite(f)? f : null
    }

    for (const it of buckets.flat()) {
      const issuer = String(it?.nameOfIssuer ?? it?.nameofissuer ?? it?.issuer ?? '').trim()
      if (!issuer) continue
      const classTitle = String(it?.titleOfClass ?? it?.titleofclass ?? it?.class ?? '').trim() || null
      const cusip = String(it?.cusip ?? '').trim() || null
      const valueK = toNum(it?.value); const valueUSD = valueK!=null ? valueK*1000 : null
      const shares  = toNum(it?.shrsOrPrnAmt?.sshPrnamt ?? it?.sshPrnamt ?? it?.shrsOrPrnAmt ?? it?.prnAmt ?? it?.shares)
      const symbol =
        (it?.issuerTradingSymbol ?? it?.tradingSymbol ?? it?.symbol ?? null)
          ? String(it?.issuerTradingSymbol ?? it?.tradingSymbol ?? it?.symbol).toUpperCase()
          : null
      rows.push({ issuer, symbol, valueUSD, shares, class: classTitle, cusip })
    }
  } catch {
    const blocks = fileText.split(/<\s*infoTable\s*>|<\s*infotable\s*>/i).slice(1)
    for (const b of blocks){
      const get = (tag:string)=> b.match(new RegExp(`<\\s*${tag}\\s*>([\\s\\S]*?)<\\s*/\\s*${tag}\\s*>`,'i'))?.[1]?.trim() || null
      const issuer = get('nameOfIssuer') || get('nameofissuer') || ''
      if (!issuer) continue
      const classT = get('titleOfClass') || get('titleofclass')
      const cusip  = get('cusip')
      const shStr  = get('sshPrnamt') || get('sshprnamt')
      const valStr = get('value')
      const sh = shStr ? Number(shStr.replace(/[, ]/g,'')) : null
      const val = valStr ? Number(valStr.replace(/[, ]/g,''))*1000 : null
      rows.push({ issuer, symbol: null, class: classT, cusip, shares: sh, valueUSD: val })
    }
  }
  return rows
}

async function fetchFund(f: {name:string;cik:string}): Promise<FundOut> {
  try {
    await sleep(DELAY)
    const pick = await pickLatest13F(f.cik)
    await sleep(DELAY)
    const candidates = await listInfoTableFiles(pick.cik, pick.accession)

    let rows: Holding[] = []
    for (const url of candidates) {
      await sleep(DELAY)
      try {
        const txt = await secText(url)
        const parsed = parseInfoTable(txt)
        if (parsed.length) { rows = parsed; break }
      } catch {}
    }

    return {
      fund: f.name,
      cik: pick.cik,
      asOf: pick.reportDate || null,
      filingUrl: pick.filingHref,
      holdings: rows.sort((a,b)=>(b.valueUSD||0)-(a.valueUSD||0)),
      _source: 'submissions',
    }
  } catch (e:any) {
    return { fund: f.name, cik: f.cik, asOf: null, filingUrl: null, holdings: [], error: String(e?.message||e) }
  }
}

/* -------------- helpers -------------- */
function formatMoney(n?: number | null) {
  if (!Number.isFinite(n as number)) return '—'
  try { return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits: 0 }).format(n as number) }
  catch { return String(Math.round(n as number)) }
}

/* ---------------- core builder (identieke logica, bounded) ---------------- */
async function buildData(maxFunds: number, topN: number): Promise<FundOut[]> {
  const queue = FUNDS.slice(0, maxFunds)
  const out: FundOut[] = []

  let idx = 0
  const workers = Array.from({ length: Math.max(1, Math.min(WORKERS, queue.length)) }).map(async () => {
    while (idx < queue.length) {
      const me = idx++
      const f = queue[me]
      const result = await fetchFund(f)
      result.holdings = (result.holdings || []).slice(0, topN)
      out.push(result)
    }
  })
  await Promise.all(workers)

  const filtered = out.filter(x => (x.holdings && x.holdings.length > 0) && !x.error)
  filtered.sort((a,b)=> a.fund.localeCompare(b.fund))
  return filtered
}

/* -------------- handler -------------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const nocache = String(req.query.nocache ?? '') === '1'
  const maxFunds = Math.min(FUNDS.length, Number(req.query.funds || FUNDS.length))
  const topN = Math.min(25, Math.max(5, Number(req.query.top || 12)))

  // Edge cache voor snelle hits zonder function CPU
  res.setHeader('Cache-Control', `public, s-maxage=${EDGE_S_MAXAGE}, stale-while-revalidate=${EDGE_SWR}`)

  const CACHE_KEY = `hedgefunds:v2:${maxFunds}:${topN}`

  // nocache=1 → force fresh (handig voor testen)
  if (nocache) {
    const fresh = await buildData(maxFunds, topN)
    try { await kvSetJSON(CACHE_KEY, { items: fresh, updatedAt: Date.now() }, KV_TTL_SEC) } catch {}
    return res.status(200).json({
      items: fresh,
      hint: 'fresh (nocache=1)',
      sample: formatMoney(123456789),
    })
  }

  try {
    // Serve from KV; vlak voor TTL bg-refresh
    const snap = await kvRefreshIfStale<{ items: FundOut[]; updatedAt: number }>(
      CACHE_KEY,
      KV_TTL_SEC,
      KV_REVALIDATE,
      async () => {
        const items = await buildData(maxFunds, topN)
        const payload = { items, updatedAt: Date.now() }
        try { await kvSetJSON(CACHE_KEY, payload, KV_TTL_SEC) } catch {}
        return payload
      }
    )

    if (snap?.items) {
      return res.status(200).json({
        items: snap.items,
        hint: 'KV snapshot (SWR refresh)',
        sample: formatMoney(123456789),
      })
    }

    // Fallback (eerste keer): build & store
    const items = await buildData(maxFunds, topN)
    try { await kvSetJSON(CACHE_KEY, { items, updatedAt: Date.now() }, KV_TTL_SEC) } catch {}
    return res.status(200).json({
      items,
      hint: 'fresh fill',
      sample: formatMoney(123456789),
    })
  } catch (e:any) {
    return res.status(200).json({
      items: [],
      hint: 'SEC fetch failed',
      detail: String(e?.message || e),
      sample: formatMoney(123456789),
    })
  }
}