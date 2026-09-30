import { createContext, useCallback, use } from 'react'

import type {
  AppStoreAction,
  AppStoreState,
  ProfileUpdatesState,
} from './app-state'

export const AppStateContext = createContext<AppStoreState | null>(null)
export const AppDispatchContext =
  createContext<AppStoreActionDispatcher | null>(null)

export type AppStoreActionDispatcher = (action: AppStoreAction) => void

const useSelector = <T>(select: (state: AppStoreState) => T): T => {
  const state = use(AppStateContext)
  if (!state) throw new Error('app store is missing its provider')
  return select(state)
}

export const useAppDispatch = (): AppStoreActionDispatcher => {
  const dispatch = use(AppDispatchContext)
  if (!dispatch) throw new Error('app store is missing its provider')
  return dispatch
}

export const useRunState = () => useSelector((s) => s.runState)

export const usePendingFailureList = () => useSelector((s) => s.pendingFailures)

export const useProfileUpdates = (): ProfileUpdatesState =>
  useSelector((s) => s.profileUpdates)

export const useProfileLoadingCache = (): ReadonlySet<string> =>
  useSelector((s) => s.profileUpdates.loading)

/** Mark profiles as updating outside backend events (update-all, per-item buttons). */
export const useSetProfileLoading = () => {
  const dispatch = useAppDispatch()
  return useCallback(
    (uids: readonly string[], loading: boolean) =>
      dispatch({ type: 'profileLoading/set', uids, loading }),
    [dispatch],
  )
}

export const useTestAllCounter = () => useSelector((s) => s.testAllCounter)
