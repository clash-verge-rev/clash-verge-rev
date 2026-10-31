import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useReducer } from 'react'

import { useVerge } from '@/hooks/use-verge'
import delayManager, { type DelayUpdate } from '@/services/delay'
import speedManager, {
  DEFAULT_SPEED_TEST_URL,
  SPEED_TEST_WINDOW_MS,
  type SpeedUpdate,
} from '@/services/speed'
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

const identity = <T>(_: T, next: T): T => next

const INITIAL_DELAY: DelayUpdate = { delay: -1, updatedAt: 0 }

const INITIAL_SPEED: SpeedUpdate = {
  speed: -1,
  peak: 0,
  downloaded: 0,
  elapsed: 0,
  updatedAt: 0,
  error: undefined,
}

export interface UseProxyDelayState {
  delayState: DelayUpdate
  delayValue: number
  speedValue: number
  peakValue: number
  speedError?: string
  isPreset: boolean
  timeout: number
  onDelay: () => Promise<void>
}

export function useProxyDelayState(
  member: ResolvedProxyMember,
  groupName: string,
  options: { withSpeed?: boolean } = {},
): UseProxyDelayState {
  const { withSpeed = true } = options
  const name = member.ref.name
  const details = memberDetails(member)
  const unresolved = member.kind === 'unresolved'
  const isPreset = unresolved || PRESET_PROXY_NAMES.includes(name)
  const [delayState, setDelayState] = useReducer(identity, INITIAL_DELAY)
  const [speedState, setSpeedState] = useReducer(identity, INITIAL_SPEED)
  const { verge } = useVerge()
  const timeout = verge?.default_latency_timeout || 10000
  const speedUrl = verge?.speed_test_url || DEFAULT_SPEED_TEST_URL

  useEffect(() => {
    if (isPreset) return
    delayManager.setListener(name, groupName, setDelayState)
    return () => {
      delayManager.removeListener(name, groupName)
    }
  }, [name, groupName, isPreset])

  useEffect(() => {
    if (isPreset) return
    speedManager.setListener(name, groupName, setSpeedState)
    const cached = speedManager.getSpeedUpdate(name, groupName)
    if (cached) setSpeedState({ ...cached })
    return () => {
      speedManager.removeListener(name, groupName)
    }
  }, [name, groupName, isPreset])

  const updateDelay = useCallback(() => {
    if (unresolved) {
      setDelayState(INITIAL_DELAY)
      return
    }
    const cachedUpdate = delayManager.getDelayUpdate(name, groupName)
    if (cachedUpdate) {
      setDelayState({ ...cachedUpdate })
      return
    }

    const fallbackDelay = delayManager.getDelayFix(member, groupName)
    if (fallbackDelay === -1) {
      setDelayState({ delay: -1, updatedAt: 0 })
      return
    }

    let updatedAt = 0
    const history = details?.history
    if (history && history.length > 0) {
      const lastRecord = history[history.length - 1]
      const parsed = Date.parse(lastRecord.time)
      if (!Number.isNaN(parsed)) {
        updatedAt = parsed
      }
    }

    setDelayState({ delay: fallbackDelay, updatedAt })
  }, [details?.history, groupName, member, name, unresolved])

  useEffect(() => {
    updateDelay()
  }, [updateDelay])

  const onDelay = useLockFn(async () => {
    if (!isInteractableMember(member)) return
    setDelayState({ delay: -2, updatedAt: Date.now() })
    setSpeedState({
      speed: -2,
      peak: 0,
      downloaded: 0,
      elapsed: 0,
      updatedAt: Date.now(),
    })
    const delayUpd = await delayManager.checkDelay(member, groupName, timeout)
    setDelayState(delayUpd)
    if (!withSpeed) return
    try {
      const speedUpd = await speedManager.checkSpeed(
        name,
        groupName,
        speedUrl,
        SPEED_TEST_WINDOW_MS,
      )
      setSpeedState(speedUpd)
    } catch (error) {
      setSpeedState({
        speed: 0,
        peak: 0,
        downloaded: 0,
        elapsed: 0,
        updatedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  return {
    delayState,
    delayValue: delayState.delay,
    speedValue: speedState.speed,
    peakValue: speedState.peak,
    speedError: speedState.error,
    isPreset,
    timeout,
    onDelay,
  }
}
