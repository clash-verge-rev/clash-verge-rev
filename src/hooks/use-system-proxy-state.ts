import { useRef } from 'react'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import { useVerge } from '@/hooks/use-verge'
import { useSystemData } from '@/providers/app-data-context'
import {
  getAutotemProxy,
  getEmbeddedServerPort,
  patchVergeConfig,
} from '@/services/cmds'
import {
  getCacheData,
  revalidateQueries,
  useQuery,
} from '@/services/query-client'

// 系统代理状态检测统一逻辑
export const useSystemProxyState = () => {
  const { verge, mutateVerge } = useVerge()
  const { sysproxy } = useSystemData()
  const displayedMixedPort = useDisplayedMixedPort()
  const { data: autoproxy } = useQuery({
    queryKey: ['getAutotemProxy'],
    queryFn: getAutotemProxy,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  const { data: pacPort } = useQuery({
    queryKey: ['getEmbeddedServerPort'],
    queryFn: getEmbeddedServerPort,
  })

  const { proxy_auto_config, proxy_host } = verge ?? {}

  // OS 实际状态：enable + 地址匹配本应用
  const indicator = (() => {
    const host = proxy_host || '127.0.0.1'
    if (proxy_auto_config) {
      if (!autoproxy?.enable) return false
      if (!pacPort) return false
      return autoproxy.url === `http://${host}:${pacPort}/commands/pac`
    } else {
      if (!sysproxy?.enable) return false
      return sysproxy.server === `${host}:${displayedMixedPort}`
    }
  })()

  // "最后一次生效"模式：快速连续点击时，只执行最终状态
  const pendingRef = useRef<boolean | null>(null)
  const busyRef = useRef(false)

  const toggleSystemProxy = async (enabled: boolean) => {
    // Roll failed optimistic writes back to the latest confirmed state.
    let confirmed =
      getCacheData<IVergeConfig>(['getVergeConfig'])?.enable_system_proxy ??
      false
    mutateVerge(
      (prev) => (prev ? { ...prev, enable_system_proxy: enabled } : prev),
      false,
    )
    pendingRef.current = enabled

    if (busyRef.current) return
    busyRef.current = true

    let failed = false
    try {
      while (pendingRef.current !== null) {
        const target = pendingRef.current
        pendingRef.current = null
        // Revalidate once below so a refetch failure cannot look like a patch failure.
        await patchVergeConfig({ enable_system_proxy: target })
        confirmed = target
        if (!target && verge?.auto_close_connection) {
          await closeAllConnections().catch(() => {})
        }
      }
    } catch (error) {
      failed = true
      mutateVerge(
        (prev) => (prev ? { ...prev, enable_system_proxy: confirmed } : prev),
        false,
      )
      // Queued requests assumed the failed state was reached.
      pendingRef.current = null
      throw error
    } finally {
      busyRef.current = false
      const revalidated = revalidateQueries([
        ['getVergeConfig'],
        ['getSystemProxy'],
        ['getAutotemProxy'],
      ])
      if (failed) {
        // Preserve the classified toggle failure.
        try {
          await revalidated
        } catch (error) {
          console.warn(
            '[system-proxy] revalidating after a failed toggle failed too:',
            error,
          )
        }
      } else {
        await revalidated
      }
    }
  }

  const invalidateProxyState = () =>
    revalidateQueries([['getSystemProxy'], ['getAutotemProxy']])

  return {
    indicator,
    toggleSystemProxy,
    invalidateProxyState,
  }
}
