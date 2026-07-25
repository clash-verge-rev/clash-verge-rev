import {
  revalidateQuery,
  setCacheData,
  useQuery,
} from '@/services/query-client'
import { checkUpdateSafe } from '@/services/update'

import { useVerge } from './use-verge'

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
  setCacheData([LAST_CHECK_KEY], now)
  return now
}

// --- useUpdate hook ---

export const useUpdate = (enabled: boolean = true) => {
  const { verge } = useVerge()
  const { auto_check_update } = verge || {}

  // Determine if we should check for updates
  // If enabled is explicitly false, don't check
  // Otherwise, respect the auto_check_update setting (or default to true if null/undefined for manual triggers)
  const shouldCheck = enabled && auto_check_update !== false

  const { data: updateInfo, isFetching: isValidating } = useQuery({
    queryKey: ['checkUpdate'],
    queryFn: async () => {
      const result = await checkUpdateSafe()
      updateLastCheckTime()
      return result
    },
    enabled: shouldCheck,
    retry: 2,
    staleTime: 60 * 60 * 1000,
    refetchInterval: 24 * 60 * 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  })

  // 手动触发检查更新：使用 revalidateQuery 强制重新获取，
  // 不依赖 SWR 的 enabled 状态，确保 auto_check_update 关闭时
  // 点击首页"最后检查时间"仍能真正发起网络请求。
  // SWR 在 key 为 null（enabled: false）时 mutate 不会执行 fetch。
  const checkUpdate = async () => {
    const data = await revalidateQuery(['checkUpdate'])
    return { data }
  }

  // Shared last check timestamp
  const { data: lastCheckUpdate } = useQuery({
    queryKey: [LAST_CHECK_KEY],
    queryFn: readLastCheckTime,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return {
    updateInfo,
    checkUpdate,
    loading: isValidating,
    lastCheckUpdate: lastCheckUpdate ?? null,
  }
}
