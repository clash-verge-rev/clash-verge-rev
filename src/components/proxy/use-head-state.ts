import { useCallback, useEffect, useReducer } from 'react'

import { useProfiles } from '@/hooks/use-profiles'
import {
  profileTestUrls,
  commitProfileTestUrl,
} from '@/services/proxy-test-url'

import { ProxySortType } from './use-filter-sort'

export interface HeadState {
  open?: boolean
  showType: boolean
  sortType: ProxySortType
  filterText: string
  filterMatchCase?: boolean
  filterMatchWholeWord?: boolean
  filterUseRegularExpression?: boolean
  textState: 'url' | 'filter' | null
  testUrl: string
}

type HeadStateStorage = Record<string, Record<string, HeadState>>

const HEAD_STATE_KEY = 'proxy-head-state'
export const DEFAULT_STATE: HeadState = {
  open: false,
  showType: true,
  sortType: 0,
  filterText: '',
  filterMatchCase: false,
  filterMatchWholeWord: false,
  filterUseRegularExpression: false,
  textState: null,
  testUrl: '',
}

type HeadStateAction =
  | { type: 'reset'; profile: string }
  | { type: 'replace'; profile: string; payload: Record<string, HeadState> }
  | { type: 'update'; groupName: string; patch: Partial<HeadState> }
  | { type: 'urls'; urls: Record<string, string> }

interface LoadedHeadState {
  profile: string | null
  heads: Record<string, HeadState>
}

function headStateReducer(
  state: LoadedHeadState,
  action: HeadStateAction,
): LoadedHeadState {
  switch (action.type) {
    case 'reset':
      return { profile: action.profile, heads: {} }
    case 'replace':
      return { profile: action.profile, heads: action.payload }
    case 'urls': {
      let heads = state.heads
      for (const [name, testUrl] of Object.entries(action.urls)) {
        if (heads[name]?.testUrl === testUrl) continue
        heads = {
          ...heads,
          [name]: { ...DEFAULT_STATE, ...heads[name], testUrl },
        }
      }
      return heads === state.heads ? state : { ...state, heads }
    }
    case 'update': {
      const prev = state.heads[action.groupName] || DEFAULT_STATE
      return {
        ...state,
        heads: {
          ...state.heads,
          [action.groupName]: { ...prev, ...action.patch },
        },
      }
    }
    default:
      return state
  }
}

export function useHeadStateNew() {
  const { profiles, current: profile } = useProfiles()
  const current = profiles?.current || ''

  const [{ profile: loadedProfile, heads: state }, dispatch] = useReducer(
    headStateReducer,
    { profile: null, heads: {} },
  )

  useEffect(() => {
    const urls = profile ? profileTestUrls(profile) : {}
    if (loadedProfile === current) {
      dispatch({ type: 'urls', urls })
      return
    }
    try {
      const data = JSON.parse(
        localStorage.getItem(HEAD_STATE_KEY) || '{}',
      ) as HeadStateStorage

      const value = data?.[current] || {}
      for (const [name, testUrl] of Object.entries(urls)) {
        value[name] = { ...DEFAULT_STATE, ...value[name], testUrl }
      }

      if (value && typeof value === 'object') {
        dispatch({ type: 'replace', profile: current, payload: value })
      } else {
        dispatch({ type: 'reset', profile: current })
      }
    } catch {
      dispatch({ type: 'reset', profile: current })
    }
  }, [current, loadedProfile, profile])

  useEffect(() => {
    if (loadedProfile !== current) return
    const timer = setTimeout(() => {
      try {
        const item = localStorage.getItem(HEAD_STATE_KEY)

        let data = (item ? JSON.parse(item) : {}) as HeadStateStorage

        if (!data || typeof data !== 'object') data = {}

        data[current] = state

        localStorage.setItem(HEAD_STATE_KEY, JSON.stringify(data))
      } catch {}
    })

    return () => clearTimeout(timer)
  }, [state, current, loadedProfile])

  const setHeadState = useCallback(
    (groupName: string, obj: Partial<HeadState>) => {
      dispatch({ type: 'update', groupName, patch: obj })
      if (current && obj.testUrl !== undefined) {
        void commitProfileTestUrl(current, groupName, obj.testUrl)
      }
    },
    [current],
  )

  return [state, setHeadState] as const
}
