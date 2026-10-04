export type Mode = 'rule' | 'global' | 'direct'
export type Page = 'home' | 'proxies' | 'profiles' | 'settings' | 'logs'

export interface Status {
  platform: 'android' | 'harmony' | 'preview'
  vpn: 'stopped' | 'connecting' | 'running' | 'error'
  coreReady: boolean
  canTestDelay?: boolean
  canChooseFile?: boolean
  activeProfileId?: string
  coreVersion?: string
  mode?: Mode
  lastError?: string
}

export interface Profile {
  id: string
  name: string
  active: boolean
  updatedAt?: string
  sourceHost?: string
}

// Mirrors Clash Verge Rev's IProxyItem / IProxyGroupItem subset.
export interface ProxyItem {
  name: string
  type: string
  delay?: number
}

export interface ProxyGroup {
  name: string
  type: string
  now: string
  all: ProxyItem[]
}

export interface LogItem {
  time: string
  level: string
  message: string
}

export interface BridgeMethods {
  status: { params: Record<string, never>; result: Status }
  'profiles.list': { params: Record<string, never>; result: Profile[] }
  'profiles.import': {
    params: { name: string; url?: string; content?: string }
    result: Profile
  }
  'profiles.activate': { params: { id: string }; result: null }
  'profiles.update': { params: { id: string }; result: null }
  'vpn.start': { params: Record<string, never>; result: null }
  'vpn.stop': { params: Record<string, never>; result: null }
  'proxies.list': { params: Record<string, never>; result: ProxyGroup[] }
  'proxies.select': { params: { group: string; name: string }; result: null }
  'proxies.delay': { params: { name: string }; result: { delay: number } }
  'settings.mode': { params: { mode: Mode }; result: null }
  'logs.list': { params: Record<string, never>; result: LogItem[] }
  'native.settings': { params: Record<string, never>; result: null }
}
