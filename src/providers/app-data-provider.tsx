import { useQuery } from '@tanstack/react-query'
import { listen } from '@tauri-apps/api/event'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  getBaseConfig,
  getRuleProviders,
  getRules,
} from 'tauri-plugin-mihomo-api'

import { useVerge } from '@/hooks/use-verge'
import {
  calcuProxies,
  calcuProxyProviders,
  getAppUptime,
  getRunningMode,
  getSystemProxy,
} from '@/services/cmds'

import { AppDataContext, AppDataContextType } from './app-data-context'

const TQ_MIHOMO = {
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  staleTime: 1500,
  retry: 3,
  retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 3000),
} as const

const TQ_DEFAULTS = {
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  staleTime: 5000,
  retry: 2,
} as const

// 全局数据提供者组件
export const AppDataProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const { verge } = useVerge()

  const {
    data: proxiesData,
    isPending: isProxiesPending,
    refetch: refreshProxy,
  } = useQuery({
    queryKey: ['getProxies'],
    queryFn: calcuProxies,
    ...TQ_MIHOMO,
  })

  const {
    data: clashConfig,
    isPending: isClashConfigPending,
    refetch: refreshClashConfig,
  } = useQuery({
    queryKey: ['getClashConfig'],
    queryFn: getBaseConfig,
    ...TQ_MIHOMO,
  })

  const { data: proxyProviders, refetch: refreshProxyProviders } = useQuery({
    queryKey: ['getProxyProviders'],
    queryFn: calcuProxyProviders,
    ...TQ_MIHOMO,
  })

  const { data: ruleProviders, refetch: refreshRuleProviders } = useQuery({
    queryKey: ['getRuleProviders'],
    queryFn: getRuleProviders,
    ...TQ_MIHOMO,
  })

  const { data: rulesData, refetch: refreshRules } = useQuery({
    queryKey: ['getRules'],
    queryFn: getRules,
    ...TQ_MIHOMO,
  })

  const refreshProxyRef = useRef(refreshProxy)
  const refreshRulesRef = useRef(refreshRules)
  const refreshRuleProvidersRef = useRef(refreshRuleProviders)
  useEffect(() => {
    refreshProxyRef.current = refreshProxy
  }, [refreshProxy])
  useEffect(() => {
    refreshRulesRef.current = refreshRules
  }, [refreshRules])
  useEffect(() => {
    refreshRuleProvidersRef.current = refreshRuleProviders
  }, [refreshRuleProviders])

  useEffect(() => {
    let lastProfileId: string | null = null
    let lastUpdateTime = 0
    const refreshThrottle = 800
    const cleanupFns: Array<() => void> = []

    const handleProfileChanged = (event: { payload: string }) => {
      const newProfileId = event.payload
      const now = Date.now()
      if (
        lastProfileId === newProfileId &&
        now - lastUpdateTime < refreshThrottle
      ) {
        return
      }
      lastProfileId = newProfileId
      lastUpdateTime = now
      refreshRulesRef.current().catch(() => {})
      refreshRuleProvidersRef.current().catch(() => {})
    }

    const handleRefreshProxy = () => {
      const now = Date.now()
      if (now - lastUpdateTime <= refreshThrottle) return
      lastUpdateTime = now
      refreshProxyRef.current().catch(() => {})
    }

    const initializeListeners = async () => {
      try {
        const unlistenProfile = await listen<string>(
          'profile-changed',
          handleProfileChanged,
        )
        cleanupFns.push(unlistenProfile)
      } catch (error) {
        console.error('[AppDataProvider] 监听 Profile 事件失败:', error)
      }

      try {
        const unlistenProxy = await listen(
          'verge://refresh-proxy-config',
          handleRefreshProxy,
        )
        cleanupFns.push(unlistenProxy)
      } catch (error) {
        console.warn('[AppDataProvider] 设置 Tauri 事件监听器失败:', error)
      }
    }

    void initializeListeners()

    return () => {
      cleanupFns.forEach((fn) => {
        try {
          fn()
        } catch (error) {
          console.error('[DataProvider] Cleanup error:', error)
        }
      })
    }
  }, [])

  const { data: sysproxy, refetch: refreshSysproxy } = useQuery({
    queryKey: ['getSystemProxy'],
    queryFn: getSystemProxy,
    ...TQ_DEFAULTS,
  })

  const { data: runningMode } = useQuery({
    queryKey: ['getRunningMode'],
    queryFn: getRunningMode,
    ...TQ_DEFAULTS,
  })

  const { data: uptimeData } = useQuery({
    queryKey: ['appUptime'],
    queryFn: getAppUptime,
    ...TQ_DEFAULTS,
    refetchInterval: 3000,
    retry: 1,
  })

  // 提供统一的刷新方法
  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshProxy(),
      refreshClashConfig(),
      refreshRules(),
      refreshSysproxy(),
      refreshProxyProviders(),
      refreshRuleProviders(),
    ])
  }, [
    refreshProxy,
    refreshClashConfig,
    refreshRules,
    refreshSysproxy,
    refreshProxyProviders,
    refreshRuleProviders,
  ])

  // 聚合所有数据
  const value = useMemo(() => {
    // 计算系统代理地址
    const calculateSystemProxyAddress = () => {
      if (!verge || !clashConfig) return '-'

      const isPacMode = verge.proxy_auto_config ?? false

      if (isPacMode) {
        // PAC模式：显示我们期望设置的代理地址
        const proxyHost = verge.proxy_host || '127.0.0.1'
        const proxyPort =
          verge.verge_mixed_port || clashConfig.mixedPort || 7897
        return `${proxyHost}:${proxyPort}`
      } else {
        // HTTP代理模式：优先使用系统地址，但如果格式不正确则使用期望地址
        const systemServer = sysproxy?.server
        if (
          systemServer &&
          systemServer !== '-' &&
          !systemServer.startsWith(':')
        ) {
          return systemServer
        } else {
          // 系统地址无效，返回期望的代理地址
          const proxyHost = verge.proxy_host || '127.0.0.1'
          const proxyPort =
            verge.verge_mixed_port || clashConfig.mixedPort || 7897
          return `${proxyHost}:${proxyPort}`
        }
      }
    }

    return {
      // 数据
      proxies: proxiesData,
      clashConfig,
      rules: rulesData?.rules ?? [],
      sysproxy,
      runningMode,
      uptime: uptimeData || 0,

      // 提供者数据
      proxyProviders: proxyProviders || {},
      ruleProviders: ruleProviders?.providers || {},

      systemProxyAddress: calculateSystemProxyAddress(),

      // core 数据加载状态
      isCoreDataPending: isProxiesPending || isClashConfigPending,

      // 刷新方法
      refreshProxy,
      refreshClashConfig,
      refreshRules,
      refreshSysproxy,
      refreshProxyProviders,
      refreshRuleProviders,
      refreshAll,
    } as AppDataContextType
  }, [
    proxiesData,
    clashConfig,
    isProxiesPending,
    isClashConfigPending,
    rulesData,
    sysproxy,
    runningMode,
    uptimeData,
    proxyProviders,
    ruleProviders,
    verge,
    refreshProxy,
    refreshClashConfig,
    refreshRules,
    refreshSysproxy,
    refreshProxyProviders,
    refreshRuleProviders,
    refreshAll,
  ])

  return <AppDataContext value={value}>{children}</AppDataContext>
}
