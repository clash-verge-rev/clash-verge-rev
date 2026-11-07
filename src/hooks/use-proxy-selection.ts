import { useCallback, useRef } from 'react'

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
  const pendingRequestRef = useRef<ProxyChangeRequest | null>(null)
  const isProcessingRef = useRef(false)
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

  const flushChangeQueue = useCallback(async () => {
    if (isProcessingRef.current) return
    isProcessingRef.current = true

    try {
      while (pendingRequestRef.current) {
        const request = pendingRequestRef.current
        pendingRequestRef.current = null
        await executeChange(request)
      }
    } finally {
      isProcessingRef.current = false
      if (pendingRequestRef.current) {
        void flushChangeQueue()
      }
    }
  }, [executeChange])

  const select = useCallback(
    (groupName: string, proxyName: string, fixed?: string) => {
      pendingRequestRef.current = {
        groupName,
        proxyName,
        fixed,
      }
      void flushChangeQueue()
    },
    [flushChangeQueue],
  )

  return { select }
}
