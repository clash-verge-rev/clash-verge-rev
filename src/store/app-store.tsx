import { useEffect, useReducer } from 'react'
import type { ReactNode } from 'react'

import { getPendingFailures, getRuntimeState } from '@/services/cmds'
import { bindStoreDispatch } from '@/services/mutate'

import { appStoreReducer, initialAppStoreState } from './app-state'
import { AppDispatchContext, AppStateContext } from './app-store-context'

/**
 * Single app store (React context + reducer, per the frozen design). Event-bus
 * handlers write through pure reducer actions; the effect below is the store's
 * own data seeding (initial read plus the poll/focus safety net the old
 * run-state query provided).
 */
export const AppStoreProvider = ({ children }: { children?: ReactNode }) => {
  const [state, dispatch] = useReducer(appStoreReducer, initialAppStoreState)

  useEffect(() => {
    bindStoreDispatch(dispatch)
    return () => bindStoreDispatch(null)
  }, [])

  useEffect(() => {
    const readRunState = () => {
      getRuntimeState()
        .then((runState) => dispatch({ type: 'runState/loaded', runState }))
        .catch(() => {})
    }
    const readPendingFailures = () => {
      getPendingFailures()
        .then((failures) =>
          dispatch({ type: 'pendingFailures/loaded', failures }),
        )
        .catch((error) => {
          console.warn('[app-store] pending failures could not be read:', error)
        })
    }

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
    }
  }, [])

  return (
    <AppStateContext value={state}>
      <AppDispatchContext value={dispatch}>{children}</AppDispatchContext>
    </AppStateContext>
  )
}
