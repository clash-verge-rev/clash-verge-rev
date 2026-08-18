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
      // Queued requests were based on a state that never landed.
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
