import useSWR, { mutate as globalMutate, SWRConfiguration } from 'swr'

import { checkUpdateSafe } from '@/services/update'

import { useVerge } from './use-verge'

export interface UpdateInfo {
  version: string
  body: string
  date: string
  available: boolean
  downloadAndInstall: (onEvent?: any) => Promise<void>
}

// --- Last check timestamp (shared via SWR + localStorage) ---

const LAST_CHECK_KEY = 'last_check_update'

export const readLastCheckTime = (): number | null => {
  const stored = localStorage.getItem(LAST_CHECK_KEY)
  if (!stored) return null
  const ts = parseInt(stored, 10)
  return isNaN(ts) ? null : ts
}

export const updateLastCheckTime = (timestamp?: number): number => {
  const now = timestamp ?? Date.now()
  localStorage.setItem(LAST_CHECK_KEY, now.toString())
  globalMutate(LAST_CHECK_KEY, now, false)
  return now
}

// --- useUpdate hook ---

export const useUpdate = (
  enabled: boolean = true,
  options?: SWRConfiguration,
) => {
  const { verge } = useVerge()
  const { auto_check_update } = verge || {}

  // Determine if we should check for updates
  // If enabled is explicitly false, don't check
  // Otherwise, respect the auto_check_update setting (or default to true if null/undefined for manual triggers)
  const shouldCheck = enabled && auto_check_update !== false

  const {
    data: updateInfo,
    mutate: checkUpdate,
    isValidating,
  } = useSWR(shouldCheck ? 'checkUpdate' : null, checkUpdateSafe, {
    errorRetryCount: 2,
    revalidateIfStale: false,
    revalidateOnFocus: false,
    focusThrottleInterval: 36e5, // 1 hour
    refreshInterval: 24 * 60 * 60 * 1000, // 24 hours
    dedupingInterval: 60 * 60 * 1000, // 1 hour
    ...options,
    onSuccess: (...args) => {
      updateLastCheckTime()
      options?.onSuccess?.(...args)
    },
  })

  // Shared last check timestamp
  const { data: lastCheckUpdate } = useSWR(LAST_CHECK_KEY, readLastCheckTime, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  })

  return {
    updateInfo,
    checkUpdate,
    loading: isValidating,
    lastCheckUpdate: lastCheckUpdate ?? null,
  }
}
