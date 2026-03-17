import { useRef } from 'react'
import useSWR, { mutate } from 'swr'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import { useVerge } from '@/hooks/use-verge'
import { useAppData } from '@/providers/app-data-context'
import { getAutotemProxy } from '@/services/cmds'

// 系统代理状态检测统一逻辑
export const useSystemProxyState = () => {
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { sysproxy, clashConfig } = useAppData()
  const { data: autoproxy } = useSWR('getAutotemProxy', getAutotemProxy, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  })

  const {
    enable_system_proxy,
    proxy_auto_config,
    proxy_host,
    verge_mixed_port,
  } = verge ?? {}

  // OS 实际状态：enable + 地址匹配本应用
  const indicator = (() => {
    const host = proxy_host || '127.0.0.1'
    if (proxy_auto_config) {
      if (!autoproxy?.enable) return false
      const pacPort = import.meta.env.DEV ? 11233 : 33331
      return autoproxy.url === `http://${host}:${pacPort}/commands/pac`
    } else {
      if (!sysproxy?.enable) return false
      const port = verge_mixed_port || clashConfig?.mixedPort || 7897
      return sysproxy.server === `${host}:${port}`
    }
  })()

  // "最后一次生效"模式：快速连续点击时，只执行最终状态
  const pendingRef = useRef<boolean | null>(null)
  const busyRef = useRef(false)

  const toggleSystemProxy = async (enabled: boolean) => {
    mutateVerge({ ...verge, enable_system_proxy: enabled }, false)
    pendingRef.current = enabled

    if (busyRef.current) return
    busyRef.current = true

    try {
      while (pendingRef.current !== null) {
        const target = pendingRef.current
        pendingRef.current = null
        if (!target && verge?.auto_close_connection) {
          await closeAllConnections().catch(() => {})
        }
        await patchVerge({ enable_system_proxy: target })
      }
    } finally {
      busyRef.current = false
      await Promise.all([mutate('getSystemProxy'), mutate('getAutotemProxy')])
    }
  }

  return {
    indicator,
    configState: enable_system_proxy ?? false,
    toggleSystemProxy,
  }
}
