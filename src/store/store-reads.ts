import {
  getPendingFailures,
  getRuntimeState,
  getSidecarFailure,
  type RunState,
} from '@/services/cmds'

import type { AppStoreAction } from './app-state'

export const createStoreReads = (
  dispatch: (action: AppStoreAction) => void,
) => {
  let runRevision = 0
  let failureRevision = 0
  let current: RunState | null = null
  let latestRead: Promise<RunState> | null = null

  const acceptRunState = (runState: RunState) => {
    runRevision += 1
    latestRead = null
    current = runState
    dispatch({ type: 'runState/loaded', runState })
  }

  const readRunState = (): Promise<RunState> => {
    const revision = ++runRevision
    const read: Promise<RunState> = getRuntimeState().then((runState) => {
      if (revision === runRevision) {
        current = runState
        dispatch({ type: 'runState/loaded', runState })
      }
      if (latestRead && latestRead !== read) return latestRead
      return current ?? runState
    })
    latestRead = read
    return read
  }

  const readPendingFailures = () => {
    const revision = ++failureRevision
    getSidecarFailure()
      .then((snapshot) => {
        if (revision === failureRevision) {
          dispatch({ type: 'sidecarFailure/loaded', snapshot })
        }
      })
      .catch((error) => {
        console.warn('[app-store] Sidecar failure could not be read:', error)
      })
    getPendingFailures()
      .then((failures) => {
        if (revision === failureRevision) {
          dispatch({ type: 'pendingFailures/loaded', failures })
        }
      })
      .catch((error) => {
        console.warn('[app-store] pending failures could not be read:', error)
      })
  }

  return {
    acceptRunState,
    readRunState,
    readPendingFailures,
    invalidate: () => {
      runRevision += 1
      failureRevision += 1
      latestRead = null
    },
  }
}
