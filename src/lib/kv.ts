// src/lib/kv.ts
import { kv } from '@vercel/kv'

/** Get JSON from Vercel KV. Returns undefined on miss or error. */
export async function kvGetJSON<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await kv.get(key)
    if (raw == null) return undefined
    if (typeof raw === 'string') return JSON.parse(raw) as T
    return raw as T
  } catch {
    return undefined
  }
}

/** Sidecar key to estimate age when TTL is not exposed. */
const tsKey = (key: string) => `${key}__ts`

/** Set JSON into KV with optional TTL seconds. Also writes sidecar timestamp. */
export async function kvSetJSON(key: string, value: unknown, ttlSec?: number) {
  try {
    const payload = JSON.stringify(value)
    const now = Date.now()
    if (ttlSec && Number.isFinite(ttlSec)) {
      const ex = Math.max(1, Math.floor(ttlSec))
      await Promise.all([
        kv.set(key, payload, { ex }),
        kv.set(tsKey(key), String(now), { ex }),
      ])
    } else {
      await Promise.all([
        kv.set(key, payload),
        kv.set(tsKey(key), String(now)),
      ])
    }
  } catch {
    // swallow — caller will still have 'value'
  }
}

/** Simple read-through cache helper. */
export async function withCache<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const cached = await kvGetJSON<T>(key)
  if (cached !== undefined) return cached
  const fresh = await fn()
  await kvSetJSON(key, fresh, ttlSec)
  return fresh
}

// ---- Optional helpers used by kvRefreshIfStale ----

async function getTtlSeconds(key: string): Promise<number | null> {
  try {
    const t = await (kv as any).ttl?.(key)
    return typeof t === 'number' && t >= 0 ? t : null
  } catch {
    return null
  }
}

async function getSidecarTs(key: string): Promise<number | undefined> {
  try {
    const raw = await kv.get<string>(tsKey(key))
    if (!raw) return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

/**
 * Return cached value if present; if TTL remaining ≤ revalidateSeconds,
 * trigger a background refresh. If no cache: fetch fresh synchronously.
 */
export async function kvRefreshIfStale<T>(
  key: string,
  ttlSeconds: number,
  revalidateSeconds: number,
  refresher: () => Promise<T>
): Promise<T | null> {
  const current = await kvGetJSON<T>(key)

  let remaining: number | null = await getTtlSeconds(key)
  if (remaining == null && ttlSeconds > 0) {
    const ts = await getSidecarTs(key)
    if (ts) {
      const ageSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
      remaining = Math.max(0, ttlSeconds - ageSec)
    }
  }

  if (current === undefined) {
    try {
      const fresh = await refresher()
      await kvSetJSON(key, fresh, ttlSeconds)
      return fresh
    } catch {
      return null
    }
  }

  const shouldRevalidate =
    typeof remaining === 'number' && remaining <= Math.max(0, Math.floor(revalidateSeconds))

  if (shouldRevalidate) {
    ;(async () => {
      try {
        const fresh = await refresher()
        await kvSetJSON(key, fresh, ttlSeconds)
      } catch {
        // keep old cache
      }
    })()
  }

  return current ?? null
}