// src/lib/kv.ts
import { kv } from '@vercel/kv'

/** Get JSON from KV (returns undefined if missing) */
export async function kvGetJSON<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await kv.get<string>(key)
    if (!raw) return undefined
    return typeof raw === 'string' ? (JSON.parse(raw) as T) : ((raw as unknown) as T)
  } catch {
    return undefined
  }
}

/** Set JSON with TTL (seconds). Example: ttlSec = 300 → 5 min */
export async function kvSetJSON(key: string, value: unknown, ttlSec?: number) {
  const payload = JSON.stringify(value)
  if (ttlSec && Number.isFinite(ttlSec)) {
    await kv.set(key, payload, { ex: Math.max(1, Math.floor(ttlSec)) })
  } else {
    await kv.set(key, payload)
  }
}

/** Simple cache wrapper: tries KV first, otherwise calls fn and stores it. */
export async function withCache<T>(
  key: string,
  ttlSec: number,
  fn: () => Promise<T>
): Promise<T> {
  const cached = await kvGetJSON<T>(key)
  if (cached !== undefined) return cached
  const fresh = await fn()
  await kvSetJSON(key, fresh, ttlSec)
  return fresh
}