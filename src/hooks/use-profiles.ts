import { getProfiles, patchProfile, patchProfilesConfig } from '@/services/cmds'
import { useQuery } from '@/services/query-client'
import { debugLog } from '@/utils/debug'

export const useProfiles = () => {
  const {
    data: profiles,
    refetch,
    error,
    isFetching: isValidating,
  } = useQuery({
    queryKey: ['getProfiles'],
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

  const mutateProfiles = async () => {
    await refetch()
  }

  const patchProfiles = async (
    value: Partial<IProfilesConfig>,
    signal?: AbortSignal,
    options?: { deferRefreshOnSuccess?: boolean },
  ) => {
    try {
      if (signal?.aborted) {
        throw new DOMException('Operation was aborted', 'AbortError')
      }
      const success = await patchProfilesConfig(value)

      if (signal?.aborted) {
        throw new DOMException('Operation was aborted', 'AbortError')
      }

      if (!options?.deferRefreshOnSuccess || !success) {
        await mutateProfiles()
      }

      return success
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }

      await mutateProfiles()
      throw error
    }
  }

  const patchCurrent = async (value: Partial<IProfileItem>) => {
    if (profiles?.current) {
      await patchProfile(profiles.current, value)
      mutateProfiles()
    }
  }

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
