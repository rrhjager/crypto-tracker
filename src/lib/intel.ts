// src/lib/intel.ts
export type IntelAggregate = {
    sectors?: any | null
    macro?: any | null
    breadth?: any | null
    hedgefunds?: any | null
    congress?: any | null
    news?: any[] | null
    updatedAt: number
    meta?: { errors?: string[]; source?: 'fresh' | 'kv' }
  }
  
  export const fetcher = (u: string) => fetch(u, { cache: 'no-store' }).then(r => r.json())
  
  export function publicBaseUrl() {
    // Zet in .env: NEXT_PUBLIC_BASE_URL=https://www.signalhub.tech
    return process.env.NEXT_PUBLIC_BASE_URL || 'https://www.signalhub.tech'
  }
  
  export async function fetchIntelInitial(): Promise<IntelAggregate> {
    try {
      const r = await fetch(`${publicBaseUrl()}/api/market/intel-aggregate`, {
        headers: { 'x-ssg': '1' },
        cache: 'no-store',
      })
      return await r.json()
    } catch {
      return { updatedAt: Date.now() } as IntelAggregate
    }
  }