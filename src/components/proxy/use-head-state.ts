import { useCallback } from 'react'

import { useProfiles } from '@/hooks/use-profiles'
import {
  DEFAULT_HEAD_STATE,
  useProxyHeadStates,
  useSetProxyHeadState,
  type HeadState,
} from '@/stores/proxy-ui-store'

export type { HeadState } from '@/stores/proxy-ui-store'

export const DEFAULT_STATE = DEFAULT_HEAD_STATE

export function useHeadStateNew() {
  const { profiles } = useProfiles()
  const current = profiles?.current || ''
  const state = useProxyHeadStates(current)
  const setProxyHeadState = useSetProxyHeadState()

  const setHeadState = useCallback(
    (groupName: string, obj: Partial<HeadState>) => {
      setProxyHeadState(current, groupName, obj)
    },
    [current, setProxyHeadState],
  )

  return [state, setHeadState] as const
}
