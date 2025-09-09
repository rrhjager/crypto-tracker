// src/lib/fetchSafe.ts
export async function fetchSafe(
    url: string,
    init: RequestInit = {},
    timeoutMs = 6000,
    retries = 1
  ): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const r = await fetch(url, { ...init, signal: ctrl.signal })
        clearTimeout(t)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r
      } catch (e) {
        clearTimeout(t)
        if (attempt === retries) throw e
        await new Promise(res => setTimeout(res, 250 + attempt * 400))
      }
    }
    throw new Error('fetchSafe failed')
  }
  
  export async function okJson<T>(r: Response): Promise<T> {
    try { return await r.json() as T } catch { throw new Error('invalid json') }
  }
  
  // Standaard micro-cache voor Vercel Edge + proxies.
  // s-maxage=10: 10s “vers”, daarna
  // stale-while-revalidate=30: 30s mag een oude versie worden geserveerd terwijl op de achtergrond wordt ververst.
  export function setMicroCache(res: any, fresh = 10, stale = 30) {
    res.setHeader?.('Cache-Control', `s-maxage=${fresh}, stale-while-revalidate=${stale}`)
  }