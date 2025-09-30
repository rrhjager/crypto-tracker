// src/lib/serverCache.ts
type CacheEntry<T> = { value: T; expires: number }
const _cache = new Map<string, CacheEntry<any>>()

export function getCache<T>(key: string): T | null {
  const hit = _cache.get(key)
  if (!hit) return null
  if (Date.now() > hit.expires) { _cache.delete(key); return null }
  return hit.value as T
}

export function setCache<T>(key: string, value: T, ttlMs: number) {
  _cache.set(key, { value, expires: Date.now() + ttlMs })
}

export async function fetchJSONCached<T>(
  key: string,
  url: string,
  ttlMs = 60_000, // 1m default
  timeoutMs = 9000
): Promise<T> {
  const cached = getCache<T>(key)
  if (cached) return cached
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
    const j = (await r.json()) as T
    setCache(key, j, ttlMs)
    return j
  } finally {
    clearTimeout(timer)
  }
}