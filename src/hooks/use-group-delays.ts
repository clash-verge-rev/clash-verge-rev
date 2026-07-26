import { useEffect, useState } from 'react'

import delayManager from '@/services/delay'
import type { ResolvedProxyMember } from '@/types/proxy-view'

/**
 * The delays a list is sorting by, as a value.
 *
 * Delays live in a module-level store outside React, so a memo that reads them has nothing
 * React can depend on and goes stale — which is why the two places that sort by delay each
 * grew their own way of forcing a recompute, and why both missed the single-proxy path.
 *
 * A snapshot rather than a revision counter, deliberately: sorting becomes a pure function of
 * a value it is handed, which the exhaustive-deps rule can see. A counter would have to be
 * listed as a dependency it never reads, and the rule is right to reject that — the code this
 * replaces satisfied it with a `refreshTick >= 0 ? … : 0` ternary whose only job was to make
 * the counter look used.
 *
 * Rebuilt when a test *settles*, not on every measurement: a list re-sorting on each result
 * would reshuffle for the length of a batch, moving rows out from under the pointer. Per-proxy
 * displays stay live on their own subscription and are unaffected.
 */
export type DelaySnapshot = {
  of: (member: ResolvedProxyMember) => number
}

const snapshotOf = (group: string | null): DelaySnapshot => ({
  of: (member) => (group ? delayManager.getDelayFix(member, group) : -1),
})

export const useGroupDelays = (group: string | null): DelaySnapshot => {
  const [settled, setSettled] = useState(() => ({
    group,
    snapshot: snapshotOf(group),
  }))

  useEffect(() => {
    if (!group) return
    // A fresh object each time: its identity is what tells a memo to re-sort.
    return delayManager.addGroupListener(group, () =>
      setSettled({ group, snapshot: snapshotOf(group) }),
    )
  }, [group])

  // Derived rather than written from the effect: switching group must take effect on this
  // render, and setting state in an effect to achieve that costs an extra render pass.
  return settled.group === group ? settled.snapshot : snapshotOf(group)
}

/**
 * A value whose identity changes when a delay test settles in any of `groups`.
 *
 * For lists that draw several groups at once and sort each one separately: they do not need
 * to read the delays through a snapshot, only to know that re-sorting is due. Compared by
 * identity, so it is a dependency the exhaustive-deps rule can see.
 */
export const useGroupsDelaySettle = (groups: readonly string[]): object => {
  const [settle, setSettle] = useState<object>(() => ({}))
  // Joined so the effect tracks membership rather than the array identity, which a list
  // rebuilds on every render.
  const groupKey = groups.join('\u0000')

  useEffect(() => {
    const names = groupKey ? groupKey.split('\u0000') : []
    if (names.length === 0) return

    const unsubscribes = names.map((name) =>
      delayManager.addGroupListener(name, () => setSettle({})),
    )
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [groupKey])

  return settle
}
