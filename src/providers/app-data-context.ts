import { Context, createContext, use } from 'react'
import {
  BaseConfig,
  ProxyProvider,
  Rule,
  RuleProvider,
} from 'tauri-plugin-mihomo-api'

export interface AppDataContextType {
  proxies: any
  clashConfig: BaseConfig
  rules: Rule[]
  sysproxy: any
  runningMode?: string
  uptime: number
  proxyProviders: Record<string, ProxyProvider>
  ruleProviders: Record<string, RuleProvider>
  systemProxyAddress: string
  isCoreDataPending: boolean

  refreshProxy: () => Promise<any>
  refreshClashConfig: () => Promise<any>
  refreshRules: () => Promise<any>
  refreshSysproxy: () => Promise<any>
  refreshProxyProviders: () => Promise<any>
  refreshRuleProviders: () => Promise<any>
  refreshAll: () => Promise<any>
}

export interface ConnectionWithSpeed extends IConnectionsItem {
  curUpload: number
  curDownload: number
}

export interface ConnectionSpeedData {
  id: string
  upload: number
  download: number
  timestamp: number
}

export interface ProxiesContextType {
  proxies: any
  proxyProviders: Record<string, ProxyProvider | undefined>
  isProxiesPending: boolean
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
  refreshProxy: () => Promise<any>
  refreshClashConfig: () => Promise<any>
  refreshRules: () => Promise<any>
  refreshSysproxy: () => Promise<any>
  refreshProxyProviders: () => Promise<any>
  refreshRuleProviders: () => Promise<any>
  refreshAll: () => Promise<any>
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

export const useProxiesData = () => {
  const { proxies, proxyProviders, isProxiesPending } = useCtx(
    ProxiesContext,
    'useProxiesData',
  )

  return {
    proxies,
    proxyProviders: proxyProviders as Record<string, ProxyProvider>,
    isProxiesPending,
  }
}

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

export const useAppData = (): AppDataContextType => {
  const { proxies, proxyProviders } = useProxiesData()
  const { rules, ruleProviders } = useRulesData()
  const { clashConfig } = useClashConfigData()
  const { sysproxy, runningMode, systemProxyAddress } = useSystemData()
  const { uptime } = useUptimeData()
  const { isCoreDataPending } = useCoreDataStatus()
  const refreshers = useAppRefreshers()

  return {
    proxies,
    clashConfig: clashConfig as BaseConfig,
    rules,
    sysproxy,
    runningMode,
    uptime,
    proxyProviders: proxyProviders as Record<string, ProxyProvider>,
    ruleProviders: ruleProviders as Record<string, RuleProvider>,
    systemProxyAddress,
    isCoreDataPending,
    ...refreshers,
  }
}
