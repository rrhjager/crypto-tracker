// --- vervangt statusFromOverall + overallScore in /src/pages/crypto/[slug].tsx ---

type Status = 'BUY'|'HOLD'|'SELL'
const pill = (s: Status) =>
  s === 'BUY'  ? 'badge-buy'  :
  s === 'SELL' ? 'badge-sell' : 'badge-hold'

// Klein hulpfuncties
const clampNum = (n:number,a:number,b:number)=>Math.max(a,Math.min(b,n))
const norm01FromPts = (pts:number)=> (clampNum(pts,-2,2)+2)/4 // -2..+2 -> 0..1
const statusFromOverall = (score:number): Status =>
  score >= 66 ? 'BUY' : score <= 33 ? 'SELL' : 'HOLD'

// Probeer eerst points/status zoals je /api/indicators/* teruggeeft.
// Val terug op de “light” berekening (spread/RSI/MACD hist/volume ratio) als points/status ontbreken.
function overallScore(ind?: IndResp): { score: number, status: Status } {
  if (!ind || ind.error) return { score: 50, status: 'HOLD' }

  // 1) Lees punten/status per indicator als die bestaan (kunnen als string/number binnenkomen)
  const maPts = (() => {
    const anyMA = (ind as any).ma
    const pts = anyMA?.points
    if (pts !== undefined && pts !== null && Number.isFinite(Number(pts))) return Number(pts)
    const st = anyMA?.status ? String(anyMA.status).toUpperCase() : null
    if (st === 'BUY')  return  2
    if (st === 'SELL') return -2
    return null
  })()

  const macdPts = (() => {
    const anyMACD = (ind as any).macd
    const pts = anyMACD?.points
    if (pts !== undefined && pts !== null && Number.isFinite(Number(pts))) return Number(pts)
    const st = anyMACD?.status ? String(anyMACD.status).toUpperCase() : null
    if (st === 'BUY')  return  2
    if (st === 'SELL') return -2
    return null
  })()

  const rsiPts = (() => {
    const anyRSI = (ind as any)
    const pts = anyRSI?.rsiPoints
    if (pts !== undefined && pts !== null && Number.isFinite(Number(pts))) return Number(pts)
    const st = anyRSI?.rsiStatus ? String(anyRSI.rsiStatus).toUpperCase() : null
    if (st === 'BUY')  return  2
    if (st === 'SELL') return -2
    return null
  })()

  const volPts = (() => {
    const anyVOL = (ind as any).volume
    const pts = anyVOL?.points
    if (pts !== undefined && pts !== null && Number.isFinite(Number(pts))) return Number(pts)
    const st = anyVOL?.status ? String(anyVOL.status).toUpperCase() : null
    if (st === 'BUY')  return  2
    if (st === 'SELL') return -2
    return null
  })()

  // 2) Bepaal per indicator een 0..1 waarde
  const vMA = (() => {
    if (maPts !== null) return norm01FromPts(maPts)
    // fallback op bestaande “light” MA-score (spread) -> 0..1
    const ma50 = ind.ma?.ma50, ma200 = ind.ma?.ma200
    if (ma50 == null || ma200 == null) return null
    let maScore = 50
    if (ma50 > ma200) {
      const spread = clampNum(ma50 / Math.max(1e-9, ma200) - 1, 0, 0.2)
      maScore = 60 + (spread / 0.2) * 40
    } else if (ma50 < ma200) {
      const spread = clampNum(ma200 / Math.max(1e-9, ma50) - 1, 0, 0.2)
      maScore = 40 - (spread / 0.2) * 40
    }
    return maScore / 100
  })()

  const vRSI = (() => {
    if (rsiPts !== null) return norm01FromPts(rsiPts)
    if (typeof ind.rsi === 'number') {
      const rsiScore = clampNum(((ind.rsi - 30) / 40) * 100, 0, 100)
      return rsiScore / 100
    }
    return null
  })()

  const vMACD = (() => {
    if (macdPts !== null) return norm01FromPts(macdPts)
    const h = ind.macd?.hist
    if (typeof h === 'number') {
      const macdScore = h > 0 ? 70 : h < 0 ? 30 : 50
      return macdScore / 100
    }
    return null
  })()

  const vVOL = (() => {
    if (volPts !== null) return norm01FromPts(volPts)
    const ratio = ind.volume?.ratio
    if (typeof ratio === 'number') {
      const volScore = clampNum((ratio / 2) * 100, 0, 100)
      return volScore / 100
    }
    return null
  })()

  // 3) Weeg met MA 40%, MACD 30%, RSI 20%, VOL 10% — maar alleen aanwezigen, gewichten hernormaliseren
  const parts: Array<{w:number; v:number}> = []
  if (vMA   !== null) parts.push({ w: 0.40, v: vMA })
  if (vMACD !== null) parts.push({ w: 0.30, v: vMACD })
  if (vRSI  !== null) parts.push({ w: 0.20, v: vRSI })
  if (vVOL  !== null) parts.push({ w: 0.10, v: vVOL })

  if (!parts.length) return { score: 50, status: 'HOLD' }

  const wSum = parts.reduce((s,p)=>s+p.w,0)
  const agg01 = parts.reduce((s,p)=> s + p.v * (p.w / wSum), 0)
  const score = Math.round(agg01 * 100)
  return { score, status: statusFromOverall(score) }
}