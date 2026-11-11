import { useCallback, useMemo, useState } from 'react'

import type { SearchState } from '@/components/base'
import { compileStringMatcher } from '@/utils/search-matcher'

const initialSearch: SearchState = {
  text: '',
  matchCase: false,
  matchWholeWord: false,
  useRegularExpression: false,
}

const searches: Record<'connections' | 'rules' | 'logs', SearchState> = {
  connections: initialSearch,
  rules: initialSearch,
  logs: initialSearch,
}

const saveSearch = (page: keyof typeof searches, state: SearchState) => {
  searches[page] = state
}

export const usePageSearch = (page: keyof typeof searches) => {
  const [searchState, setSearchState] = useState(() => searches[page])
  const match = useMemo(
    () => compileStringMatcher(searchState.text, searchState).matcher,
    [searchState],
  )
  const onSearch = useCallback(
    (_match: (content: string) => boolean, state: SearchState) => {
      saveSearch(page, state)
      setSearchState(state)
    },
    [page],
  )

  return { searchState, match, onSearch }
}
