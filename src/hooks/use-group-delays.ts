import { useCallback, useSyncExternalStore } from 'react'

import delayManager, { type DelaySnapshot } from '@/services/delay'

const NO_DELAYS: DelaySnapshot = { of: () => -1 }

/**
 * The delays a list sorts by, as a value it can depend on.
 *
 * Delays live in a module-level store outside React, so a memo that reads them has nothing
 * React can see and goes stale — which is why the two places that sorted by delay each grew
 * their own way of forcing a recompute, and why both missed the single-proxy path.
 *
 * `useSyncExternalStore` rather than an effect plus state: the value is read during render
 * while the store notifies from an animation frame, so a settle landing between the two would
 * otherwise be dropped with nothing left to re-trigger it. It also keeps the identity stable
 * between settles, which a snapshot rebuilt per render would not — that would re-sort on
 * every render, which is worse than the hack it replaces.
 *
 * The store announces when a test *settles*, not on every measurement: a list re-sorting on
 * each result would reshuffle for the length of a batch, moving rows out from under the
 * pointer. Per-proxy displays stay live on their own subscription and are unaffected.
 */
export const useGroupDelays = (group: string | null): DelaySnapshot => {
  const subscribe = useCallback(
    (onSettle: () => void) =>
      group ? delayManager.addGroupListener(group, onSettle) : () => {},
    [group],
  )
  const read = useCallback(
    () => (group ? delayManager.groupDelays(group) : NO_DELAYS),
    [group],
  )

  return useSyncExternalStore(subscribe, read, read)
}

/**
 * The delays for several groups at once, keyed by group name.
 *
 * The map's identity changes whenever any of them settles, but each group's own entry keeps
 * its identity unless that group settled — so a per-group cache is not thrown away wholesale
 * because a neighbouring group finished a test.
 */
export const useGroupsDelays = (
  groups: readonly string[],
): ReadonlyMap<string, DelaySnapshot> => {
  // Joined so the subscription tracks membership rather than the array identity, which a
  // list rebuilds on every render.
  const groupKey = groups.join(' ')

  const subscribe = useCallback(
    (onSettle: () => void) => {
      const names = groupKey ? groupKey.split(' ') : []
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
