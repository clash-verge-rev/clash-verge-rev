import { useCallback, useRef } from 'react'

import { getProfiles, patchProfile, patchProfilesConfig } from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { fetchCacheData, setCacheData, useQuery } from '@/services/query-client'
import { debugLog } from '@/utils/debug'

const profilesQueryKey = ['getProfiles'] as const

export const fetchProfilesIntoCache = () =>
  fetchCacheData(profilesQueryKey, getProfiles)

export const useProfiles = () => {
  const {
    data: profiles,
    refetch,
    error,
    isFetching: isValidating,
  } = useQuery({
    queryKey: profilesQueryKey,
    queryFn: async () => {
      const data = await getProfiles()
      debugLog(
        '[useProfiles] 配置数据更新成功，配置数量:',
        data?.items?.length || 0,
      )
      return data
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 500,
    retry: 3,
    retryDelay: 1000,
    refetchInterval: false,
  })

  const refetchRef = useRef(refetch)
  refetchRef.current = refetch
  const mutateProfiles = useCallback(async () => {
    await refetchRef.current()
  }, [])

  const patchProfiles = useCallback(
    async (value: Partial<IProfilesConfig>) => {
      try {
        const result = await mutate(() => patchProfilesConfig(value), {
          id: 'patch-profiles-config',
          onFulfilled: (outcome) => {
            if (outcome.status === 'valid') {
              void setCacheData<IProfilesConfig>(profilesQueryKey, (current) =>
                current ? { ...current, ...value } : current,
              )
            }
          },
        })

        if (!result.ok) {
          // Backend Busy keeps local state untouched, as before.
          return result.value
        }
        const outcome = result.value
        if (outcome.status !== 'valid' && outcome.status !== 'busy') {
          await mutateProfiles()
        }
        return outcome
      } catch (error) {
        await mutateProfiles()
        throw error
      }
    },
    [mutateProfiles],
  )

  const patchCurrent = useCallback(
    async (value: Partial<IProfileItem>) => {
      if (profiles?.current) {
        const uid = profiles.current
        await mutate(() => patchProfile(uid, value), {
          id: `patch-profile:${uid}`,
          errorNotice: false,
        })
        void mutateProfiles()
      }
    },
    [mutateProfiles, profiles],
  )

  return {
    profiles,
    current: profiles?.items?.find((p) => p && p.uid === profiles.current),
    patchProfiles,
    patchCurrent,
    mutateProfiles,
    // 新增故障检测状态
    isLoading: isValidating,
    error,
    isStale: !profiles && !error && !isValidating, // 检测是否处于异常状态
  }
}
