import { useQuery } from '@tanstack/react-query'
import { selectNodeForGroup } from 'tauri-plugin-mihomo-api'

import {
  calcuProxies,
  getProfiles,
  patchProfile,
  patchProfilesConfig,
} from '@/services/cmds'
import { queryClient } from '@/services/query-client'
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
      if (!value.selected) {
        mutateProfiles()
      }
    }
  }

  // 根据selected的节点选择
  const activateSelected = async (profileOverride?: IProfilesConfig) => {
    try {
      debugLog('[ActivateSelected] 开始处理代理选择')

      const proxiesData = await calcuProxies()
      const profileData = profileOverride ?? profiles

      if (!profileData || !proxiesData || !profileData.items) {
        debugLog('[ActivateSelected] 代理或配置数据不可用，跳过处理')
        return
      }

      const current = profileData.items?.find(
        (e) => e && e.uid === profileData.current,
      )

      if (!current) {
        debugLog('[ActivateSelected] 未找到当前profile配置')
        return
      }

      // 检查是否有saved的代理选择
      const { selected = [] } = current
      if (selected.length === 0) {
        debugLog('[ActivateSelected] 当前profile无保存的代理选择，跳过')
        return
      }

      debugLog(
        `[ActivateSelected] 当前profile有 ${selected.length} 个代理选择配置`,
      )

      type SelectedEntry = { name?: string; now?: string }
      const selectedMap = Object.fromEntries(
        (selected as SelectedEntry[])
          .filter(
            (each): each is SelectedEntry & { name: string; now: string } =>
              each.name != null && each.now != null,
          )
          .map((each) => [each.name, each.now]),
      )

      let hasChange = false
      const newSelected: typeof selected = []
      const { global, groups } = proxiesData
      const selectableTypes = new Set([
        'Selector',
        'URLTest',
        'Fallback',
        'LoadBalance',
      ])

      // 处理所有代理组
      for (const group of [global, ...groups]) {
        if (!group) {
          continue
        }

        const { type, name, now } = group
        const savedProxy = selectedMap[name]
        const availableProxies = Array.isArray(group.all) ? group.all : []

        if (!selectableTypes.has(type)) {
          if (savedProxy != null || now != null) {
            const preferredProxy = now ? now : savedProxy
            newSelected.push({ name, now: preferredProxy })
          }
          continue
        }

        if (savedProxy == null) {
          if (now != null) {
            newSelected.push({ name, now })
          }
          continue
        }

        const existsInGroup = availableProxies.some((proxy) => {
          if (typeof proxy === 'string') {
            return proxy === savedProxy
          }

          return proxy?.name === savedProxy
        })

        if (!existsInGroup) {
          console.warn(
            `[ActivateSelected] 保存的代理 ${savedProxy} 不存在于代理组 ${name}`,
          )
          hasChange = true
          newSelected.push({ name, now: now ?? savedProxy })
          continue
        }

        if (savedProxy !== now) {
          debugLog(
            `[ActivateSelected] 需要切换代理组 ${name}: ${now} -> ${savedProxy}`,
          )
          hasChange = true
          try {
            await selectNodeForGroup(name, savedProxy)
          } catch (error: unknown) {
            console.warn(
              `[ActivateSelected] 切换代理组 ${name} 失败:`,
              error instanceof Error ? error.message : String(error),
            )
          }
        }

        newSelected.push({ name, now: savedProxy })
      }

      if (!hasChange) {
        debugLog('[ActivateSelected] 所有代理选择已经是目标状态，无需更新')
        return
      }

      debugLog(`[ActivateSelected] 完成代理切换，保存新的选择配置`)

      try {
        await patchProfile(current.uid, { selected: newSelected })
        debugLog('[ActivateSelected] 代理选择配置保存成功')

        queryClient.setQueryData(['getProxies'], await calcuProxies())
      } catch (error: unknown) {
        console.error(
          '[ActivateSelected] 保存代理选择配置失败:',
          error instanceof Error ? error.message : String(error),
        )
      }
    } catch (error: unknown) {
      console.error(
        '[ActivateSelected] 处理代理选择失败:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  return {
    profiles,
    current: profiles?.items?.find((p) => p && p.uid === profiles.current),
    activateSelected,
    patchProfiles,
    patchCurrent,
    mutateProfiles,
    // 新增故障检测状态
    isLoading: isValidating,
    error,
    isStale: !profiles && !error && !isValidating, // 检测是否处于异常状态
  }
}
