import { useLockFn } from 'ahooks'
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

  const toggleSystemProxy = useLockFn(async (enabled: boolean) => {
    mutateVerge({ ...verge, enable_system_proxy: enabled }, false)

    const updateProxyStatus = async () => {
      await new Promise((resolve) => setTimeout(resolve, enabled ? 20 : 10))
      await mutate('getSystemProxy')
      await mutate('getAutotemProxy')
    }

    try {
      if (!enabled && verge?.auto_close_connection) {
        await closeAllConnections()
      }
      await patchVerge({ enable_system_proxy: enabled })
      await updateProxyStatus()
    } catch (error) {
      console.warn('[useSystemProxyState] toggleSystemProxy failed:', error)
      mutateVerge({ ...verge, enable_system_proxy: !enabled }, false)
      await updateProxyStatus()
      throw error
    }
  })

  return {
    indicator,
    configState: enable_system_proxy ?? false,
    toggleSystemProxy,
  }
}
