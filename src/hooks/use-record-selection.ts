import { useCallback } from 'react'

import { clearSelectedNode, recordSelectedNode } from '@/services/cmds'

/**
 * Record which node a group is on, in the profile.
 *
 * The core keeps its own copy in `cache.db` and restores it when it starts, but neither half of
 * that is something the app can rely on: `profile.store-selected` comes from a merge template a
 * user is free to replace, and a service older than the durable runtime generation starts every
 * core in a directory nothing has ever run in. So the app re-applies what the profile says once
 * the core is up.
 *
 * Which makes this the rule: a selection the profile does not know about is one the next start
 * will undo. Every path that moves a group has to come through here.
 *
 * Only the group and the node are sent. Sending the whole selection list — which is what this
 * did while it built the array from `useProfiles().current` — made two selections made before
 * that list refreshed into one overwriting the other, because both were derived from the same
 * stale snapshot. The merge happens on the backend, against whatever the profile holds by then.
 */
export const useRecordSelection = () => {
  return useCallback((groupName: string, proxyName: string) => {
    recordSelectedNode(groupName, proxyName).catch((error) => {
      console.error('[Selection] 保存代理选择失败:', error)
    })
  }, [])
}

/**
 * Forget the persisted node selection for a group after its runtime fixed node is released.
 */
export const useClearSelection = () => {
  return useCallback((groupName: string) => {
    clearSelectedNode(groupName).catch((error) => {
      console.error('[Selection] 清除代理选择失败:', error)
    })
  }, [])
}
