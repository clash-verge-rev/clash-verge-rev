import type { PendingFailure, RunState } from '@/services/cmds'

/** Event-derived per-profile update tracking, shared by the profiles page and items. */
export interface ProfileUpdatesState {
  readonly loading: ReadonlySet<string>
  readonly updateRevisions: ReadonlyMap<string, number>
  readonly timerRevisions: ReadonlyMap<string, number>
}

export interface AppStoreState {
  /** Written by `run-state-changed` events and the store's safety-net poll. */
  readonly runState: RunState | null
  /** Latest backend pending-failure snapshot; toasts/dialogs dedupe on sequence. */
  readonly pendingFailures: readonly PendingFailure[]
  readonly profileUpdates: ProfileUpdatesState
  /** Bumped once per test-all request; test items run their delay test per bump. */
  readonly testAllCounter: number
  /** Mutate-funnel bookkeeping: in-flight intent ids. */
  readonly busy: ReadonlySet<string>
}

export const initialAppStoreState: AppStoreState = {
  runState: null,
  pendingFailures: [],
  profileUpdates: {
    loading: new Set(),
    updateRevisions: new Map(),
    timerRevisions: new Map(),
  },
  testAllCounter: 0,
  busy: new Set(),
}

export type AppStoreAction =
  | { type: 'runState/loaded'; runState: RunState }
  | { type: 'pendingFailures/loaded'; failures: readonly PendingFailure[] }
  | { type: 'profileUpdate/started'; uid: string }
  | { type: 'profileUpdate/completed'; uid: string }
  | { type: 'profileUpdate/timerTick'; uid: string }
  | { type: 'profileLoading/set'; uids: readonly string[]; loading: boolean }
  | { type: 'testAll/requested' }
  | { type: 'busy/started'; id: string }
  | { type: 'busy/settled'; id: string }

const bumpRevision = (
  map: ReadonlyMap<string, number>,
  uid: string,
): ReadonlyMap<string, number> => {
  const next = new Map(map)
  next.set(uid, (next.get(uid) ?? 0) + 1)
  return next
}

const withLoading = (
  state: AppStoreState,
  uids: readonly string[],
  loading: boolean,
): AppStoreState => {
  const next = new Set(state.profileUpdates.loading)
  for (const uid of uids) {
    if (loading) {
      next.add(uid)
    } else {
      next.delete(uid)
    }
  }
  return {
    ...state,
    profileUpdates: { ...state.profileUpdates, loading: next },
  }
}

export function appStoreReducer(
  state: AppStoreState,
  action: AppStoreAction,
): AppStoreState {
  switch (action.type) {
    case 'runState/loaded':
      return { ...state, runState: action.runState }
    case 'pendingFailures/loaded':
      return { ...state, pendingFailures: action.failures }
    case 'profileUpdate/started':
      if (state.profileUpdates.loading.has(action.uid)) return state
      return withLoading(state, [action.uid], true)
    case 'profileUpdate/completed': {
      const cleared = withLoading(state, [action.uid], false)
      return {
        ...cleared,
        profileUpdates: {
          ...cleared.profileUpdates,
          updateRevisions: bumpRevision(
            state.profileUpdates.updateRevisions,
            action.uid,
          ),
        },
      }
    }
    case 'profileUpdate/timerTick':
      return {
        ...state,
        profileUpdates: {
          ...state.profileUpdates,
          timerRevisions: bumpRevision(
            state.profileUpdates.timerRevisions,
            action.uid,
          ),
        },
      }
    case 'profileLoading/set':
      return withLoading(state, action.uids, action.loading)
    case 'testAll/requested':
      return { ...state, testAllCounter: state.testAllCounter + 1 }
    case 'busy/started': {
      if (state.busy.has(action.id)) return state
      const busy = new Set(state.busy)
      busy.add(action.id)
      return { ...state, busy }
    }
    case 'busy/settled': {
      if (!state.busy.has(action.id)) return state
      const busy = new Set(state.busy)
      busy.delete(action.id)
      return { ...state, busy }
    }
  }
}
