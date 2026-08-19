import { useCallback } from 'react'

import { forgetSelectedNode, recordSelectedNode } from '@/services/cmds'

/**
 * Persists every group selection because core-local state is not durable across all run modes.
 * Send only the changed pair so concurrent selections merge against fresh backend state.
 */
export const useRecordSelection = () => {
  return useCallback(async (groupName: string, proxyName: string) => {
    try {
      await recordSelectedNode(groupName, proxyName)
    } catch (error) {
      console.error('[Selection] 保存代理选择失败:', error)
    }
  }, [])
}

export const useForgetSelection = () => {
  return useCallback(async (groupName: string) => {
    try {
      await forgetSelectedNode(groupName)
    } catch (error) {
      console.error('[Selection] 清除代理选择失败:', error)
    }
  }, [])
}
