import { describe, expect, test } from 'vitest'

import type { SearchState } from '@/components/base'

import {
  compilePageSearchMatcher,
  createDefaultPageSearchStates,
  updatePageSearchState,
} from './states'

const searchState = (text: string): SearchState => ({
  text,
  matchCase: false,
  matchWholeWord: false,
  useRegularExpression: false,
})

describe('page search session state', () => {
  test('keeps each page search independent', () => {
    const initial = createDefaultPageSearchStates()
    const withConnections = updatePageSearchState(
      initial,
      'connections',
      searchState('github.com'),
    )
    const withRules = updatePageSearchState(
      withConnections,
      'rules',
      searchState('MATCH'),
    )

    expect(withRules.connections.text).toBe('github.com')
    expect(withRules.rules.text).toBe('MATCH')
    expect(withRules.logs.text).toBe('')
    expect(initial).toEqual(createDefaultPageSearchStates())
  })

  test('derives the restored matcher from the saved options', () => {
    const matcher = compilePageSearchMatcher({
      text: '^GitHub$',
      matchCase: true,
      matchWholeWord: false,
      useRegularExpression: true,
    })

    expect(matcher('GitHub')).toBe(true)
    expect(matcher('github')).toBe(false)
  })

  test('clearing one page restores unfiltered results only for that page', () => {
    const populated = updatePageSearchState(
      updatePageSearchState(
        createDefaultPageSearchStates(),
        'connections',
        searchState('example.com'),
      ),
      'logs',
      searchState('warning'),
    )
    const cleared = updatePageSearchState(
      populated,
      'connections',
      searchState(''),
    )

    expect(compilePageSearchMatcher(cleared.connections)('anything')).toBe(true)
    expect(cleared.logs.text).toBe('warning')
  })

  test('starts a new app session with fresh page states', () => {
    const firstSession = createDefaultPageSearchStates()
    const secondSession = createDefaultPageSearchStates()

    firstSession.connections.text = 'changed outside React'

    expect(secondSession.connections.text).toBe('')
    expect(secondSession.connections).not.toBe(firstSession.connections)
  })
})
