type Entry<T> = { value: T; ts: number; ttlMs: number };
const store = new Map<string, Entry<any>>();

export function setCache<T>(key: string, value: T, ttlMs = 55_000) {
  store.set(key, { value, ts: Date.now(), ttlMs }); return value;
}
export function getCache<T>(key: string): T | null {
  const e = store.get(key); if (!e) return null;
  if (Date.now() - e.ts > e.ttlMs) { store.delete(key); return null; }
  return e.value as T;
}