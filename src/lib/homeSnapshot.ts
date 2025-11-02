// src/lib/homeSnapshot.ts
export type HomeSnap = {
    symbol: string
    status: 'BUY'|'SELL'|'HOLD'|string|null
    score: number | null
    rsi: number | null
    macdHist: number | null
    maTrend: 'BUY'|'SELL'|'HOLD'|null
    updatedAt: number | null
  }
  export type HomeSnapshotResponse = {
    markets: string[]
    updatedAt: number
    items: Record<string, HomeSnap[]>
  }
  
  export const fetcher = async (url: string): Promise<HomeSnapshotResponse|null> => {
    const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }})
    if (r.status === 304) return null
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  }
  
  export const LABEL_TO_KEY: Record<string,string> = {
    'AEX':'AEX', 'S&P 500':'SP500', 'NASDAQ':'NASDAQ', 'Dow Jones':'DOWJONES',
    'DAX':'DAX', 'FTSE 100':'FTSE100', 'Nikkei 225':'NIKKEI225',
    'Hang Seng':'HANGSENG', 'Sensex':'SENSEX'
  }