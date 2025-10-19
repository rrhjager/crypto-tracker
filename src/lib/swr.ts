// /src/lib/swr.ts
import type { SWRConfiguration } from 'swr'

export const swrConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  revalidateIfStale: true,
  refreshWhenHidden: false,       // geen polling als tab hidden
  refreshInterval: 60_000,        // standaard 60s
  dedupingInterval: 60_000,       // 1 fetch per key per minuut
  isVisible: () =>
    typeof document === 'undefined'
      ? true
      : document.visibilityState === 'visible',
}