import { useCallback, useEffect, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'

import {
  type AppStoreAction,
  appStoreReducer,
  initialAppStoreState,
} from './app-state'
import {
  AppDispatchContext,
  AppReadsContext,
  AppStateContext,
} from './app-store-context'
import { createStoreReads } from './store-reads'

/**
 * Single app store (React context + reducer, per the frozen design). Event-bus
 * handlers write through pure reducer actions; the effect below is the store's
 * own data seeding (initial read plus the poll/focus safety net the old
 * run-state query provided).
 */
export const AppStoreProvider = ({ children }: { children?: ReactNode }) => {
  const [state, dispatch] = useReducer(appStoreReducer, initialAppStoreState)

  const reads = useMemo(() => createStoreReads(dispatch), [dispatch])
  const dispatchEvent = useCallback(
    (action: AppStoreAction) => {
      if (action.type === 'runState/loaded')
        reads.acceptRunState(action.runState)
      else dispatch(action)
    },
    [reads],
  )

  useEffect(() => {
    const readRunState = () => {
      void reads.readRunState().catch(() => {})
    }
    const { readPendingFailures } = reads

    readRunState()
    readPendingFailures()

    // Transitions normally arrive by event; the visible poll is the run-state
    // safety net, and regaining focus re-reads both snapshots.
    const pollRunState = () => {
      if (document.visibilityState !== 'visible') return
      readRunState()
    }
    const readWhenFocused = () => {
      if (document.visibilityState !== 'visible') return
      readRunState()
      readPendingFailures()
    }
    window.addEventListener('focus', readWhenFocused)
    document.addEventListener('visibilitychange', readWhenFocused)
    const timer = window.setInterval(pollRunState, 30000)

    return () => {
      window.removeEventListener('focus', readWhenFocused)
      document.removeEventListener('visibilitychange', readWhenFocused)
      window.clearInterval(timer)
      reads.invalidate()
    }
  }, [reads])

  return (
    <AppStateContext value={state}>
      <AppReadsContext value={reads}>
        <AppDispatchContext value={dispatchEvent}>
          {children}
        </AppDispatchContext>
      </AppReadsContext>
    </AppStateContext>
  )
}
