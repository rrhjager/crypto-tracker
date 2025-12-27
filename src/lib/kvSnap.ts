// src/lib/kvSnap.ts
import { kv } from '@vercel/kv'

/**
 * Defaults:
 * - Fresh window: 5 min (homepage voelt “up-to-date”)
 * - Stale window: 25 min (snel blijven serven, ondertussen refresh)
 * - KV TTL: 24 uur (zodat je na inactiviteit nog steeds instant data hebt)
 */
export const SNAP_FRESH_MS = 5 * 60_000
export const SNAP_STALE_MS = 25 * 60_000
export const SNAP_TTL_MS   = 24 * 60 * 60_000

type Snap<T> = { ts: number; data: T }

/** Genereer consistente keys (NIET wijzigen -> voorkomt cache-breaks) */
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

/** Read snapshot; null als niet aanwezig */
export async function readSnap<T>(key: string): Promise<Snap<T> | null> {
  try {
    const v = await kv.get<Snap<T>>(key)
    if (!v || typeof (v as any).ts !== 'number') return null
    return v
  } catch {
    return null
  }
}

/** Write snapshot (met TTL) */
export async function writeSnap<T>(key: string, data: T, ttlMs: number = SNAP_TTL_MS): Promise<void> {
  const payload: Snap<T> = { ts: Date.now(), data }
  try {
    await kv.set(key, payload, { px: ttlMs })
  } catch {
    // KV storing mag nooit request breken
  }
}

/**
 * Read-through cache: serve fresh; of stale + background refresh; of fetch & store.
 * NB: background refresh is "best effort" in serverless, maar helpt in de praktijk veel.
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
  const ttlMs = opts?.ttlMs ?? SNAP_TTL_MS

  const snap = await readSnap<T>(key)
  const now = Date.now()

  // 1) Fresh
  if (snap && (now - snap.ts) <= freshMs) {
    return { data: snap.data, stale: false }
  }

  // 2) Stale-while-revalidate
  if (snap && (now - snap.ts) <= (freshMs + staleMs)) {
    ;(async () => {
      try {
        const next = await fetcher()
        await writeSnap(key, next, ttlMs)
        opts?.onBackground?.()
      } catch (e) {
        opts?.onBackground?.(e)
      }
    })()
    return { data: snap.data, stale: true }
  }

  // 3) Missing/expired → fetch, store, return
  const fresh = await fetcher()
  await writeSnap(key, fresh, ttlMs)
  return { data: fresh, stale: false }
}