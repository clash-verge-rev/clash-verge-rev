import { useCallback, useMemo, useRef } from 'react'
import {
  closeConnection,
  getConnections,
  selectNodeForGroup,
  unfixedProxy,
} from 'tauri-plugin-mihomo-api'

import { useRecordSelection } from '@/hooks/use-record-selection'
import { useVerge } from '@/hooks/use-verge'
import { clearSelectedNode, syncTrayProxySelection } from '@/services/cmds'
import { debugLog } from '@/utils/debug'

// 缓存连接清理
const cleanupConnections = async (previousProxy: string) => {
  try {
    const { connections } = await getConnections()
    const cleanupPromises = (connections ?? [])
      .filter((conn) => conn.chains.includes(previousProxy))
      .map((conn) => closeConnection(conn.id))

    if (cleanupPromises.length > 0) {
      await Promise.allSettled(cleanupPromises)
      debugLog(`[ProxySelection] 清理了 ${cleanupPromises.length} 个连接`)
    }
  } catch (error) {
    console.warn('[ProxySelection] 连接清理失败:', error)
  }
}

interface ProxySelectionOptions {
  onSuccess?: () => void
  onError?: (error: any) => void
  enableConnectionCleanup?: boolean
}

interface ProxyChangeRequest {
  groupName: string
  proxyName: string
  previousProxy?: string
}

// 代理选择 Hook
export const useProxySelection = (options: ProxySelectionOptions = {}) => {
  const recordSelection = useRecordSelection()
  const { verge } = useVerge()
  const pendingRequestRef = useRef<ProxyChangeRequest | null>(null)
  const isProcessingRef = useRef(false)

  const { onSuccess, onError, enableConnectionCleanup = true } = options

  // 缓存
  const config = useMemo(
    () => ({
      autoCloseConnection: verge?.auto_close_connection ?? false,
      enableConnectionCleanup,
    }),
    [verge?.auto_close_connection, enableConnectionCleanup],
  )

  // 切换节点
  const syncTraySelection = useCallback(() => {
    syncTrayProxySelection().catch((error) => {
      console.error('[ProxySelection] 托盘状态同步失败:', error)
    })
  }, [])

  const clearPersistedSelection = useCallback((groupName: string) => {
    clearSelectedNode(groupName).catch((error) => {
      console.error('[ProxySelection] 清除代理选择保存失败:', error)
    })
  }, [])

  const executeChange = useCallback(
    async (request: ProxyChangeRequest) => {
      const { groupName, proxyName, previousProxy } = request
      debugLog(`[ProxySelection] 代理切换: ${groupName} -> ${proxyName}`)

      try {
        await selectNodeForGroup(groupName, proxyName)
        onSuccess?.()
        syncTraySelection()
        recordSelection(groupName, proxyName)
        debugLog(
          `[ProxySelection] 代理和状态同步完成: ${groupName} -> ${proxyName}`,
        )

        if (
          config.enableConnectionCleanup &&
          config.autoCloseConnection &&
          previousProxy
        ) {
          void cleanupConnections(previousProxy)
        }
      } catch (error) {
        console.error(
          `[ProxySelection] 代理切换失败: ${groupName} -> ${proxyName}`,
          error,
        )
        onError?.(error)
      }
    },
    [config, onError, onSuccess, recordSelection, syncTraySelection],
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

  const changeProxy = useCallback(
    (groupName: string, proxyName: string, previousProxy?: string) => {
      pendingRequestRef.current = {
        groupName,
        proxyName,
        previousProxy,
      }
      void flushChangeQueue()
    },
    [flushChangeQueue],
  )

  const handleSelectChange = useCallback(
    (groupName: string, previousProxy?: string) =>
      (event: { target: { value: string } }) => {
        const newProxy = event.target.value
        changeProxy(groupName, newProxy, previousProxy)
      },
    [changeProxy],
  )

  const handleProxyGroupChange = useCallback(
    (group: { name: string; now?: string }, proxy: { name: string }) => {
      changeProxy(group.name, proxy.name, group.now)
    },
    [changeProxy],
  )

  const clearProxySelection = useCallback(
    async (groupName: string) => {
      debugLog(`[ProxySelection] 取消固定代理: ${groupName}`)

      try {
        await unfixedProxy(groupName)
        onSuccess?.()
        syncTraySelection()
        // Unfixing must also drop the profile record, otherwise core start
        // re-applies the old node via activate_selected_nodes and re-fixes it.
        clearPersistedSelection(groupName)
        debugLog(`[ProxySelection] 代理固定状态已取消: ${groupName}`)
      } catch (error) {
        console.error(`[ProxySelection] 取消固定代理失败: ${groupName}`, error)
        onError?.(error)
      }
    },
    [clearPersistedSelection, onError, onSuccess, syncTraySelection],
  )

  return {
    changeProxy,
    clearProxySelection,
    handleSelectChange,
    handleProxyGroupChange,
  }
}
