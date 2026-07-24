import { useClashInfo, useRuntimeConfig } from '@/hooks/use-clash'
import { useVerge } from '@/hooks/use-verge'
import { useClashConfigData } from '@/providers/app-data-context'
import { resolveDisplayedMixedPort } from '@/utils/mixed-port'

export const useDisplayedMixedPort = () => {
  const { clashConfig } = useClashConfigData()
  const { data: runtimeConfig } = useRuntimeConfig()
  const { clashInfo } = useClashInfo()
  const { verge } = useVerge()

  return resolveDisplayedMixedPort({
    live: clashConfig?.mixedPort,
    runtime: runtimeConfig?.['mixed-port'],
    selected: verge?.verge_mixed_port,
    merge: clashInfo?.mixed_port,
  })
}
