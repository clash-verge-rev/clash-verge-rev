import {
  getVergeConfig,
  getProfiles,
  getClashMode,
  getSystemProxy,
  getAutoProxy,
  getClashInfo,
  getRuntimeState,
  getEmbeddedServerPort,
  getProxyView,
} from '@/services/cmds'

import type { QuickMode } from './quick-panel'

export async function readQuickPanelSnapshot() {
  // These values come from local configuration and remain readable without Mihomo.
  const [verge, profiles, mode, system, auto, info, runtime, pacPort] =
    await Promise.all([
      getVergeConfig(),
      getProfiles(),
      getClashMode(),
      getSystemProxy(),
      getAutoProxy(),
      getClashInfo(),
      getRuntimeState(),
      getEmbeddedServerPort(),
    ])
  const host = verge.proxy_host || '127.0.0.1'
  const systemProxy = verge.proxy_auto_config
    ? auto.enable && auto.url === `http://${host}:${pacPort}/commands/pac`
    : system.enable && system.server === `${host}:${info.mixed_port}`
  const base = {
    verge,
    profiles,
    mode: (mode === 'rule' || mode === 'global' || mode === 'direct'
      ? mode
      : null) as QuickMode | null,
    systemProxy,
    runtime,
  }
  if (runtime.mode === 'NotRunning')
    return { ...base, view: null, connection: 'offline' as const }
  try {
    return { ...base, view: await getProxyView(), connection: 'ready' as const }
  } catch {
    return { ...base, view: null, connection: 'unavailable' as const }
  }
}
