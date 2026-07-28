import { useCallback } from 'react'

import { useProfiles } from '@/hooks/use-profiles'

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
 */
export const useRecordSelection = () => {
  const { current, patchCurrent } = useProfiles()

  return useCallback(
    (groupName: string, proxyName: string) => {
      if (!current) return

      const selected = current.selected ? [...current.selected] : []
      const index = selected.findIndex((item) => item.name === groupName)
      if (index < 0) {
        selected.push({ name: groupName, now: proxyName })
      } else {
        selected[index] = { name: groupName, now: proxyName }
      }

      patchCurrent({ selected }).catch((error) => {
        console.error('[Selection] 保存代理选择失败:', error)
      })
    },
    [current, patchCurrent],
  )
}
