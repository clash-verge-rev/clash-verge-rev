import React, { useCallback, useMemo, useRef } from 'react'
import {
  getBaseConfig,
  getRuleProviders,
  getRules,
} from 'tauri-plugin-mihomo-api'

import { useClashInfo, useRuntimeConfig } from '@/hooks/use-clash'
import { useVerge } from '@/hooks/use-verge'
import { getProxyView, getSystemProxy } from '@/services/cmds'
import { useQuery } from '@/services/query-client'
import { useRunState } from '@/store/app-store-context'
import { resolveDisplayedMixedPort } from '@/utils/mixed-port'

import {
  ClashConfigContext,
  CoreDataStatusContext,
  ProxiesContext,
  RefreshersContext,
  RulesContext,
  SystemContext,
} from './app-data-context'

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

function useStableFn<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: Parameters<T>) => ref.current(...args), []) as T
}

// 全局数据提供者组件
export const AppDataProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const { verge } = useVerge()
  const { data: runtimeConfig } = useRuntimeConfig()
  const { clashInfo } = useClashInfo()

  const {
    data: proxyView,
    error: proxyViewError,
    isPending: isProxyViewPending,
    refetch: _refetchProxyView,
  } = useQuery({
    queryKey: ['getProxyView'],
    queryFn: getProxyView,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    ...TQ_MIHOMO,
  })

  const {
    data: clashConfig,
    isPending: isClashConfigPending,
    refetch: _refetchClashConfig,
  } = useQuery({
    queryKey: ['getClashConfig'],
    queryFn: getBaseConfig,
    ...TQ_MIHOMO,
  })

  const { data: ruleProviders, refetch: _refetchRuleProviders } = useQuery({
    queryKey: ['getRuleProviders'],
    queryFn: getRuleProviders,
    ...TQ_MIHOMO,
    revalidateOnMount: false,
  })

  const { data: rulesData, refetch: _refetchRules } = useQuery({
    queryKey: ['getRules'],
    queryFn: getRules,
    ...TQ_MIHOMO,
  })

  const { data: sysproxy, refetch: _refetchSysproxy } = useQuery({
    queryKey: ['getSystemProxy'],
    queryFn: getSystemProxy,
    ...TQ_DEFAULTS,
  })

  // Store-owned run state; the event bus and the store's safety net write it.
  const runState = useRunState()
  const isRunningModePending = runState == null
  const runningMode = runState?.mode

  const refreshProxy = useStableFn(_refetchProxyView)
  const refreshClashConfig = useStableFn(_refetchClashConfig)
  const refreshRules = useStableFn(_refetchRules)
  const refreshSysproxy = useStableFn(_refetchSysproxy)
  const refreshRuleProviders = useStableFn(_refetchRuleProviders)

  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshProxy(),
      refreshClashConfig(),
      refreshRules(),
      refreshSysproxy(),
      refreshRuleProviders(),
    ])
  }, [
    refreshProxy,
    refreshClashConfig,
    refreshRules,
    refreshSysproxy,
    refreshRuleProviders,
  ])

  const proxiesValue = useMemo(
    () => ({
      proxyView,
      isProxyViewPending,
      isProxyViewError: Boolean(proxyViewError),
    }),
    [proxyView, isProxyViewPending, proxyViewError],
  )

  const rulesValue = useMemo(
    () => ({
      rules: rulesData?.rules ?? [],
      ruleProviders: ruleProviders?.providers || {},
    }),
    [rulesData, ruleProviders],
  )

  const clashConfigValue = useMemo(
    () => ({
      clashConfig,
      isClashConfigPending,
    }),
    [clashConfig, isClashConfigPending],
  )

  // Resolved from local sources rather than via useDisplayedMixedPort: that hook reads the
  // ClashConfig context, and this component is the one providing it.
  const displayedMixedPort = resolveDisplayedMixedPort({
    live: clashConfig?.mixedPort,
    runtime: runtimeConfig?.['mixed-port'],
    selected: verge?.verge_mixed_port,
    merge: clashInfo?.mixed_port,
  })

  const systemValue = useMemo(() => {
    const calculateSystemProxyAddress = () => {
      if (!verge) return '-'

      const isPacMode = verge.proxy_auto_config ?? false

      if (isPacMode) {
        // PAC模式：显示我们期望设置的代理地址
        const proxyHost = verge.proxy_host || '127.0.0.1'
        return `${proxyHost}:${displayedMixedPort}`
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
          return `${proxyHost}:${displayedMixedPort}`
        }
      }
    }

    return {
      sysproxy,
      runningMode,
      isRunningModePending,
      systemProxyAddress: calculateSystemProxyAddress(),
    }
  }, [sysproxy, runningMode, isRunningModePending, verge, displayedMixedPort])

  const coreDataStatusValue = useMemo(
    () => ({
      isCoreDataPending: isProxyViewPending || isClashConfigPending,
    }),
    [isProxyViewPending, isClashConfigPending],
  )

  const refreshersValue = useMemo(
    () => ({
      refreshProxy,
      refreshClashConfig,
      refreshRules,
      refreshSysproxy,
      refreshRuleProviders,
      refreshAll,
    }),
    [
      refreshProxy,
      refreshClashConfig,
      refreshRules,
      refreshSysproxy,
      refreshRuleProviders,
      refreshAll,
    ],
  )

  return (
    <ProxiesContext value={proxiesValue}>
      <RulesContext value={rulesValue}>
        <ClashConfigContext value={clashConfigValue}>
          <SystemContext value={systemValue}>
            <CoreDataStatusContext value={coreDataStatusValue}>
              <RefreshersContext value={refreshersValue}>
                {children}
              </RefreshersContext>
            </CoreDataStatusContext>
          </SystemContext>
        </ClashConfigContext>
      </RulesContext>
    </ProxiesContext>
  )
}
