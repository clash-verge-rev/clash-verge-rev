import { useLockFn } from 'ahooks'
import { useCallback, useSyncExternalStore } from 'react'

import { useVerge } from '@/hooks/use-verge'
import delayManager, { type DelayUpdate } from '@/services/delay'
import {
  isInteractableMember,
  memberDetails,
  type ResolvedProxyMember,
} from '@/types/proxy-view'

const PRESET_PROXY_NAMES = [
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'COMPATIBLE',
]

const INITIAL_DELAY: DelayUpdate = { delay: -1, updatedAt: 0 }

export interface UseProxyDelayState {
  delayState: DelayUpdate
  delayValue: number
  isPreset: boolean
  timeout: number
  onDelay: () => Promise<void>
}

export function useProxyDelayState(
  member: ResolvedProxyMember,
  groupName: string,
): UseProxyDelayState {
  const name = member.ref.name
  const details = memberDetails(member)
  const unresolved = member.kind === 'unresolved'
  const isPreset = unresolved || PRESET_PROXY_NAMES.includes(name)
  const { verge } = useVerge()
  const timeout = verge?.default_latency_timeout || 10000

  const subscribe = useCallback(
    (onChange: () => void) =>
      isPreset ? () => {} : delayManager.addListener(name, groupName, onChange),
    [name, groupName, isPreset],
  )
  const read = useCallback(
    () =>
      unresolved ? undefined : delayManager.getDelayUpdate(name, groupName),
    [name, groupName, unresolved],
  )
  const cachedUpdate = useSyncExternalStore(subscribe, read, read)

  const fallbackDelay = delayManager.getDelayFix(member, groupName)
  const history = details?.history
  const lastRecord = history?.[history.length - 1]
  const parsed = lastRecord ? Date.parse(lastRecord.time) : NaN
  const delayState =
    cachedUpdate ??
    (fallbackDelay === -1
      ? INITIAL_DELAY
      : {
          delay: fallbackDelay,
          updatedAt: Number.isNaN(parsed) ? 0 : parsed,
        })

  const onDelay = useLockFn(async () => {
    if (!isInteractableMember(member)) return
    await delayManager.checkDelay(member, groupName, timeout)
  })

  return {
    delayState,
    delayValue: delayState.delay,
    isPreset,
    timeout,
    onDelay,
  }
}
