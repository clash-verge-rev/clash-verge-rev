import { createContextState } from 'foxact/create-context-state'
import { useCallback, useMemo } from 'react'

import type { SearchState } from '@/components/base'
import { compileStringMatcher } from '@/utils/search-matcher'

export type PageSearchKey = 'connections' | 'rules' | 'logs'
export type PageSearchStates = Record<PageSearchKey, SearchState>

const createDefaultSearchState = (): SearchState => ({
  text: '',
  matchCase: false,
  matchWholeWord: false,
  useRegularExpression: false,
})

export const createDefaultPageSearchStates = (): PageSearchStates => ({
  connections: createDefaultSearchState(),
  rules: createDefaultSearchState(),
  logs: createDefaultSearchState(),
})

export const updatePageSearchState = (
  states: PageSearchStates,
  page: PageSearchKey,
  searchState: SearchState,
): PageSearchStates => ({ ...states, [page]: searchState })

export const compilePageSearchMatcher = (searchState: SearchState) =>
  compileStringMatcher(searchState.text, searchState).matcher

const [PageSearchStateProvider, usePageSearchStates, useSetPageSearchStates] =
  createContextState<PageSearchStates>(createDefaultPageSearchStates())

const usePageSearchState = (page: PageSearchKey) => {
  const searchState = usePageSearchStates()[page]
  const setPageSearchStates = useSetPageSearchStates()
  const matcher = useMemo(
    () => compilePageSearchMatcher(searchState),
    [searchState],
  )
  const setSearchState = useCallback(
    (nextSearchState: SearchState) => {
      setPageSearchStates((states) =>
        updatePageSearchState(states, page, nextSearchState),
      )
    },
    [page, setPageSearchStates],
  )

  return { matcher, searchState, setSearchState }
}

const [ThemeModeProvider, useThemeMode, useSetThemeMode] = createContextState<
  'light' | 'dark'
>()

// save the state of each profile item loading
const [LoadingCacheProvider, useLoadingCache, useSetLoadingCache] =
  createContextState<Set<string>>(new Set())

// save update state
const [UpdateStateProvider, useUpdateState, useSetUpdateState] =
  createContextState<boolean>(false)

export {
  ThemeModeProvider,
  useThemeMode,
  useSetThemeMode,
  LoadingCacheProvider,
  useLoadingCache,
  useSetLoadingCache,
  UpdateStateProvider,
  useUpdateState,
  useSetUpdateState,
  PageSearchStateProvider,
  usePageSearchState,
}
