import { Context, createContext, use } from 'react'
import { BaseConfig, Rule, RuleProvider } from 'tauri-plugin-mihomo-api'

import type { ProxyViewV1 } from '@/types/proxy-view'

export interface ProxiesContextType {
  proxyView: ProxyViewV1 | undefined
  isProxyViewPending: boolean
}

export interface RulesContextType {
  rules: Rule[]
  ruleProviders: Record<string, RuleProvider | undefined>
}

export interface ClashConfigContextType {
  clashConfig: BaseConfig | undefined
  isClashConfigPending: boolean
}

export interface SystemContextType {
  sysproxy: any
  runningMode?: string
  systemProxyAddress: string
}

export interface UptimeContextType {
  uptime: number
}

export interface CoreDataStatusContextType {
  isCoreDataPending: boolean
}

export interface RefreshersContextType {
  refreshProxy: () => Promise<unknown>
  refreshClashConfig: () => Promise<unknown>
  refreshRules: () => Promise<unknown>
  refreshSysproxy: () => Promise<unknown>
  refreshRuleProviders: () => Promise<unknown>
  refreshAll: () => Promise<unknown>
}

export const ProxiesContext = createContext<ProxiesContextType | null>(null)
export const RulesContext = createContext<RulesContextType | null>(null)
export const ClashConfigContext = createContext<ClashConfigContextType | null>(
  null,
)
export const SystemContext = createContext<SystemContextType | null>(null)
export const UptimeContext = createContext<UptimeContextType | null>(null)
export const CoreDataStatusContext =
  createContext<CoreDataStatusContextType | null>(null)
export const RefreshersContext = createContext<RefreshersContextType | null>(
  null,
)

const useCtx = <T>(ctx: Context<T | null>, hookName: string): T => {
  const v = use(ctx)
  if (!v) throw new Error(`${hookName} must be used within AppDataProvider`)
  return v
}

export const useProxiesData = (): ProxiesContextType =>
  useCtx(ProxiesContext, 'useProxiesData')

export const useRulesData = () => {
  const { rules, ruleProviders } = useCtx(RulesContext, 'useRulesData')

  return {
    rules,
    ruleProviders: ruleProviders as Record<string, RuleProvider>,
  }
}

export const useClashConfigData = (): ClashConfigContextType =>
  useCtx(ClashConfigContext, 'useClashConfigData')

export const useSystemData = (): SystemContextType =>
  useCtx(SystemContext, 'useSystemData')

export const useUptimeData = (): UptimeContextType =>
  useCtx(UptimeContext, 'useUptimeData')

export const useAppRefreshers = (): RefreshersContextType =>
  useCtx(RefreshersContext, 'useAppRefreshers')

export const useCoreDataStatus = (): CoreDataStatusContextType =>
  useCtx(CoreDataStatusContext, 'useCoreDataStatus')
