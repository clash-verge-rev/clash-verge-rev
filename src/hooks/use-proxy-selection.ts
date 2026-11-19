import { useCallback } from 'react'

import { switchProxyNode } from '@/services/cmds'
import { mutate } from '@/services/mutate'

interface ProxySelectionOptions {
  onError?: (error: any) => void
}

interface ProxyChangeRequest {
  groupName: string
  proxyName: string
  fixed?: string
}

export const useProxySelection = (options: ProxySelectionOptions = {}) => {
  const { onError } = options

  const executeChange = useCallback(
    async ({ groupName, proxyName, fixed }: ProxyChangeRequest) => {
      try {
        await mutate(
          () => switchProxyNode(groupName, proxyName, fixed === proxyName),
          { id: `select-proxy-node:${groupName}`, errorNotice: false },
        )
      } catch (error) {
        console.error(
          `[ProxySelection] Failed to switch proxy: ${groupName} -> ${proxyName}`,
          error,
        )
        onError?.(error)
      }
    },
    [onError],
  )

  const select = useCallback(
    (groupName: string, proxyName: string, fixed?: string) => {
      void executeChange({
        groupName,
        proxyName,
        fixed,
      })
    },
    [executeChange],
  )

  return { select }
}
