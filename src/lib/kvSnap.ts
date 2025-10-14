// src/lib/kvSnap.ts
import { kv } from '@vercel/kv'

/** Globale defaults — pas deze aan als je 15s/30s wilt */
export const SNAP_FRESH_MS = 15_000      // binnen dit venster: serve fresh from KV
export const SNAP_STALE_MS = 30_000      // extra venster: serve stale, refresh in background
export const SNAP_TTL_MS   = 5 * 60_000  // hard TTL in KV (failsafe)

type Snap<T> = { ts: number; data: T }

/** Genereer consistente keys */
export const snapKey = {
  // equities indicators
  ma:    (sym: string) => `snap:eq:ma:${sym}`,
  rsi:   (sym: string, p=14) => `snap:eq:rsi:${sym}:${p}`,
  macd:  (sym: string, f=12, s=26, sig=9) => `snap:eq:macd:${sym}:${f}:${s}:${sig}`,
  vol20: (sym: string, p=20) => `snap:eq:vol20:${sym}:${p}`,

  // crypto batches
  cryptoInd:  (csv: string) => `snap:cr:ind:${csv}`,
  cryptoPx:   (csv: string) => `snap:cr:px:${csv}`,

  // intel/news
  news: (q: string) => `snap:news:${q}`,
  congress: (limit: number) => `snap:congress:${limit}`,
  academy:  () => `snap:academy:list`,

  // any custom
  custom: (name: string) => `snap:${name}`,
}

/** Read snapshot; null als niet aanwezig of verlopen */
export async function readSnap<T>(key: string): Promise<Snap<T> | null> {
  try {
    const v = await kv.get<Snap<T>>(key)
    if (!v || typeof v.ts !== 'number') return null
    return v
  } catch {
    return null
  }
}

/** Write snapshot (met TTL) */
export async function writeSnap<T>(key: string, data: T): Promise<void> {
  const payload: Snap<T> = { ts: Date.now(), data }
  try {
    // Bewaar als JSON; TTL als failsafe
    await kv.set(key, payload, { px: SNAP_TTL_MS })
  } catch {
    // KV storing mag nooit request breken
  }
}

/**
 * Read-through cache: serve fresh; of stale + background refresh; of fetch & store.
 * - fetcher() is jouw bestaande logica die de “bron” data ophaalt/bereidt.
 * - onBackground(err?) wordt aangeroepen als we stale ser(v)en en in BG refreshen.
 */
export async function getOrRefreshSnap<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts?: {
    freshMs?: number
    staleMs?: number
    ttlMs?: number
    onBackground?: (err?: any) => void
  }
): Promise<{ data: T; stale: boolean }> {
  const freshMs = opts?.freshMs ?? SNAP_FRESH_MS
  const staleMs = opts?.staleMs ?? SNAP_STALE_MS

  const snap = await readSnap<T>(key)
  const now = Date.now()

  // 1) Fresh
  if (snap && (now - snap.ts) <= freshMs) {
    return { data: snap.data, stale: false }
  }

  // 2) Stale-while-revalidate
  if (snap && (now - snap.ts) <= (freshMs + staleMs)) {
    // fire & forget background refresh
    ;(async () => {
      try {
        const next = await fetcher()
        await writeSnap(key, next)
        opts?.onBackground?.()
      } catch (e) {
        opts?.onBackground?.(e)
      }
    })()
    return { data: snap.data, stale: true }
  }

  // 3) Expired or missing → fetch, store, return
  const fresh = await fetcher()
  await writeSnap(key, fresh)
  return { data: fresh, stale: false }
}