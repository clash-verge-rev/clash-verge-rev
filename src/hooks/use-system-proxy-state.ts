import { useRef } from 'react'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import { useVerge } from '@/hooks/use-verge'
import { useSystemData } from '@/providers/app-data-context'
import { getAutotemProxy, getEmbeddedServerPort } from '@/services/cmds'
import { revalidateQueries, useQuery } from '@/services/query-client'

// 系统代理状态检测统一逻辑
export const useSystemProxyState = () => {
  const { verge, mutateVerge, patchVerge } = useVerge()
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

  const { enable_system_proxy, proxy_auto_config, proxy_host } = verge ?? {}

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
    mutateVerge(
      (prev) => (prev ? { ...prev, enable_system_proxy: enabled } : prev),
      false,
    )
    pendingRef.current = enabled

    if (busyRef.current) return
    busyRef.current = true

    try {
      while (pendingRef.current !== null) {
        const target = pendingRef.current
        pendingRef.current = null
        await patchVerge({ enable_system_proxy: target })
        if (!target && verge?.auto_close_connection) {
          await closeAllConnections().catch(() => {})
        }
      }
    } finally {
      busyRef.current = false
      await revalidateQueries([['getSystemProxy'], ['getAutotemProxy']])
    }
  }

  const invalidateProxyState = () =>
    revalidateQueries([['getSystemProxy'], ['getAutotemProxy']])

  return {
    indicator,
    configState: enable_system_proxy ?? false,
    toggleSystemProxy,
    invalidateProxyState,
  }
}
