import { useCallback, useSyncExternalStore } from 'react'

import delayManager, { type DelaySnapshot } from '@/services/delay'
import type { ResolvedProxyMember } from '@/types/proxy-view'

/** A closed menu observes only its current member, not every settled group delay. */
export const useGroupDelays = (
  group: string | null,
  member: ResolvedProxyMember | undefined,
  menuOpen: boolean,
): DelaySnapshot | number => {
  const subscribe = useCallback(
    (onSettle: () => void) =>
      group ? delayManager.addGroupListener(group, onSettle) : () => {},
    [group],
  )
  const read = useCallback(
    () =>
      group && menuOpen
        ? delayManager.groupDelays(group)
        : group && member
          ? delayManager.getDelayFix(member, group)
          : -1,
    [group, member, menuOpen],
  )

  return useSyncExternalStore(subscribe, read, read)
}

/** Preserves unchanged group snapshot identities when another group settles. */
export const useGroupsDelays = (
  groups: readonly string[],
): ReadonlyMap<string, DelaySnapshot> => {
  // Group membership must remain unambiguous when names contain spaces.
  const groupKey = JSON.stringify(groups)

  const subscribe = useCallback(
    (onSettle: () => void) => {
      const names: string[] = JSON.parse(groupKey)
      const unsubscribes = names.map((name) =>
        delayManager.addGroupListener(name, onSettle),
      )
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe()
      }
    },
    [groupKey],
  )

  const read = useCallback(
    () => delayManager.groupsDelays(groupKey),
    [groupKey],
  )

  return useSyncExternalStore(subscribe, read, read)
}
