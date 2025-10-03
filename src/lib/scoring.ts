import type { Advice } from '@/pages/index'

// type aanpassen zodat beide pagina’s hem kunnen gebruiken
type Status = 'BUY' | 'HOLD' | 'SELL'

const clampNum = (n:number,a:number,b:number)=>Math.max(a,Math.min(b,n))
const norm01FromPts = (pts:number)=> (clampNum(pts,-2,2)+2)/4 // -2..+2 -> 0..1

export function statusFromOverall(score:number): Status {
  if (score >= 66) return 'BUY'
  if (score <= 33) return 'SELL'
  return 'HOLD'
}

export type IndResp = {
  symbol: string
  ma?: { ma50: number|null; ma200: number|null; cross?: string; status?: string; points?: number|string|null }
  rsi?: number|null
  macd?: { macd: number|null; signal: number|null; hist: number|null; status?: string; points?: number|string|null }
  volume?: { volume: number|null; avg20d: number|null; ratio: number|null; status?: string; points?: number|string|null }
  rsiStatus?: string
  rsiPoints?: number|string|null
  error?: string
}

export function overallScore(ind?: IndResp): { score: number, status: Status } {
  if (!ind || ind.error) return { score: 50, status: 'HOLD' }

  const toPts = (status?: string, pts?: number|string|null) => {
    if (pts !== undefined && pts !== null && Number.isFinite(Number(pts))) return Number(pts)
    const st = String(status||'').toUpperCase()
    if (st==='BUY') return  2
    if (st==='SELL') return -2
    return null
  }

  const maPts   = toPts(ind.ma?.status,   ind.ma?.points)
  const macdPts = toPts(ind.macd?.status, ind.macd?.points)
  const rsiPts  = toPts(ind.rsiStatus,    ind.rsiPoints)
  const volPts  = toPts(ind.volume?.status, ind.volume?.points)

  const vMA = maPts!==null ? norm01FromPts(maPts) :
    (ind.ma?.ma50!=null && ind.ma?.ma200!=null ? (ind.ma.ma50>ind.ma.ma200?0.7:0.3) : null)

  const vRSI = rsiPts!==null ? norm01FromPts(rsiPts) :
    (typeof ind.rsi==='number' ? clampNum(((ind.rsi-30)/40)*100,0,100)/100 : null)

  const vMACD = macdPts!==null ? norm01FromPts(macdPts) :
    (typeof ind.macd?.hist==='number' ? (ind.macd.hist>0?0.7:0.3) : null)

  const vVOL = volPts!==null ? norm01FromPts(volPts) :
    (typeof ind.volume?.ratio==='number' ? clampNum((ind.volume.ratio/2)*100,0,100)/100 : null)

  const parts: {w:number;v:number}[] = []
  if (vMA   !== null) parts.push({w:0.40,v:vMA})
  if (vMACD !== null) parts.push({w:0.30,v:vMACD})
  if (vRSI  !== null) parts.push({w:0.20,v:vRSI})
  if (vVOL  !== null) parts.push({w:0.10,v:vVOL})

  if (!parts.length) return { score: 50, status: 'HOLD' }

  const wSum = parts.reduce((s,p)=>s+p.w,0)
  const agg01 = parts.reduce((s,p)=> s + p.v * (p.w/wSum), 0)
  const score = Math.round(agg01*100)

  return { score, status: statusFromOverall(score) }
}