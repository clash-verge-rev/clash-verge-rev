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
  removeCacheData,
  revalidateQueries,
  useQuery,
} from '@/services/query-client'

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

  // Coalesce rapid clicks so only the latest requested state is applied.
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

    try {
      while (pendingRef.current !== null) {
        const target = pendingRef.current
        pendingRef.current = null
        await patchVergeConfig({ enable_system_proxy: target })
        confirmed = target
        if (!target && verge?.auto_close_connection) {
          await closeAllConnections().catch(() => {})
        }
      }
    } catch (error) {
      mutateVerge(
        (prev) => (prev ? { ...prev, enable_system_proxy: confirmed } : prev),
        false,
      )
      // Queued requests were based on a state that never landed.
      pendingRef.current = null
      throw error
    } finally {
      busyRef.current = false
      // Refreshing cached state is not part of the toggle's result: a failed read must not
      // turn a write that landed into a reported failure.
      try {
        await revalidateQueries([['getVergeConfig']])
      } catch (error) {
        console.warn(
          '[system-proxy] rereading the config after a toggle failed:',
          error,
        )
      }
      // Kept separate so an unreadable config cannot discard OS state that did read.
      try {
        await revalidateQueries([['getSystemProxy'], ['getAutotemProxy']])
      } catch (error) {
        console.warn(
          '[system-proxy] rereading the OS proxy after a toggle failed:',
          error,
        )
        // The indicator reports observed OS state, so an unreadable one must read as inactive
        // rather than stay live from a stale cache.
        await Promise.all([
          removeCacheData(['getSystemProxy']),
          removeCacheData(['getAutotemProxy']),
        ])
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
