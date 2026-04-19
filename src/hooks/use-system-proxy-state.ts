import { useQuery } from '@tanstack/react-query'
import { confirm } from '@tauri-apps/plugin-dialog'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import { useVerge } from '@/hooks/use-verge'
import { useAppData } from '@/providers/app-data-context'
import {
  getAutotemProxy,
  isSystemProxyHelperInstalled,
  requestSystemProxyHelperInstall,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { queryClient } from '@/services/query-client'
import getSystem from '@/utils/get-system'

const isSystemProxyPermissionDenied = (err: unknown) => {
  if (!err) return false
  const message =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : JSON.stringify(err)

  const normalized = message.toLowerCase()
  return (
    normalized.includes('admin privileges required to modify system proxy') ||
    normalized.includes('requires admin privileges') ||
    normalized.includes('permission denied') ||
    normalized.includes('operation not permitted') ||
    normalized.includes('system proxy helper unavailable')
  )
}

// 系统代理状态检测统一逻辑
export const useSystemProxyState = () => {
  const { t } = useTranslation()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { sysproxy, clashConfig } = useAppData()
  const { data: autoproxy } = useQuery({
    queryKey: ['getAutotemProxy'],
    queryFn: getAutotemProxy,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
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
        if (!target && verge?.auto_close_connection) {
          await closeAllConnections().catch(() => {})
        }
        try {
          await patchVerge({ enable_system_proxy: target })
        } catch (err) {
          const shouldTryInstallHelper =
            target &&
            getSystem() === 'macos' &&
            isSystemProxyPermissionDenied(err)

          if (!shouldTryInstallHelper) {
            throw err
          }

          const installed = await isSystemProxyHelperInstalled()
          const accepted = await confirm(
            t('settings.sections.proxyControl.tooltips.systemProxy'),
            {
              title: t('settings.sections.system.toggles.systemProxy'),
              kind: 'warning',
              okLabel: installed
                ? t('shared.actions.confirm')
                : t('settings.sections.proxyControl.actions.installService'),
              cancelLabel: t('shared.actions.cancel'),
            },
          )

          if (!accepted) {
            throw err
          }

          if (!installed) {
            showNotice.info('settings.statuses.clashService.installing')
            const result = await requestSystemProxyHelperInstall()
            if (!result.installed) {
              throw new Error(result.message, { cause: err })
            }
            showNotice.success(
              'settings.feedback.notifications.clashService.installSuccess',
            )
          }
          await patchVerge({ enable_system_proxy: target })
        }
      }
    } finally {
      busyRef.current = false
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['getSystemProxy'] }),
        queryClient.invalidateQueries({ queryKey: ['getAutotemProxy'] }),
      ])
    }
  }

  const invalidateProxyState = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['getSystemProxy'] }),
      queryClient.invalidateQueries({ queryKey: ['getAutotemProxy'] }),
    ])

  return {
    indicator,
    configState: enable_system_proxy ?? false,
    toggleSystemProxy,
    invalidateProxyState,
  }
}
