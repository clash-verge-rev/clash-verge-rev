import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { ProxySortType } from '@/components/proxy/use-filter-sort'

const PROXY_UI_STORAGE_KEY = 'proxy-ui-store'
const PROXY_UI_STORE_VERSION = 1

const LEGACY_CHAIN_MODE_KEY = 'proxy-chain-mode-enabled'
const LEGACY_CHAIN_ITEMS_KEY = 'proxy-chain-items'
const LEGACY_CHAIN_GROUP_KEY = 'proxy-chain-group'
const LEGACY_CHAIN_EXIT_NODE_KEY = 'proxy-chain-exit-node'
const LEGACY_SCROLL_POSITIONS_KEY = 'proxy-scroll-positions'
const LEGACY_HEAD_STATE_KEY = 'proxy-head-state'

export interface ProxyChainItem {
  id: string
  name: string
  type?: string
  delay?: number
}

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

export type HeadStateStorage = Record<string, Record<string, HeadState>>

export const DEFAULT_HEAD_STATE: HeadState = {
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

type SetStateAction<T> = T | ((prev: T) => T)

interface ProxyUiPersistedState {
  chainModeEnabled: boolean
  proxyChainItems: ProxyChainItem[]
  chainTargetGroup: string | null
  chainExitNode: string | null
  scrollPositions: Record<string, number>
  headStatesByProfile: HeadStateStorage
}

interface ProxyUiRuntimeState {
  chainConfigData: string | null
  selectedGroup: string | null
}

interface ProxyUiActions {
  setChainModeEnabled: (enabled: boolean) => void
  setChainConfigData: (data: string | null) => void
  setProxyChainItems: (value: SetStateAction<ProxyChainItem[]>) => void
  setSelectedGroup: (group: string | null) => void
  setChainConnection: (group: string, exitNode: string) => void
  clearChainConnection: () => void
  clearProxyChain: () => void
  setScrollPosition: (mode: string, scrollTop: number) => void
  setHeadState: (
    profile: string,
    groupName: string,
    patch: Partial<HeadState>,
  ) => void
  resetHeadState: (profile: string) => void
}

export type ProxyUiStoreState = ProxyUiPersistedState &
  ProxyUiRuntimeState &
  ProxyUiActions

const EMPTY_HEAD_STATES: Record<string, HeadState> = {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const resolveStateAction = <T>(value: SetStateAction<T>, previous: T): T =>
  typeof value === 'function' ? (value as (prev: T) => T)(previous) : value

const getStorageItem = (key: string) => {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const parseStorageJson = <T>(key: string): T | null => {
  const item = getStorageItem(key)
  if (!item) return null

  try {
    return JSON.parse(item) as T
  } catch {
    return null
  }
}

const asOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const normalizeProxyChainItems = (value: unknown): ProxyChainItem[] => {
  if (!Array.isArray(value)) return []

  return value.reduce<ProxyChainItem[]>((items, item) => {
    if (!isRecord(item)) return items
    const name = item.name
    if (typeof name !== 'string' || name.length === 0) return items

    const id = typeof item.id === 'string' ? item.id : `${name}_${items.length}`
    const chainItem: ProxyChainItem = { id, name }

    if (typeof item.type === 'string') {
      chainItem.type = item.type
    }
    if (typeof item.delay === 'number') {
      chainItem.delay = item.delay
    }

    items.push(chainItem)
    return items
  }, [])
}

const normalizeScrollPositions = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) return {}

  return Object.entries(value).reduce<Record<string, number>>(
    (positions, [key, scrollTop]) => {
      if (typeof scrollTop === 'number' && Number.isFinite(scrollTop)) {
        positions[key] = scrollTop
      }
      return positions
    },
    {},
  )
}

const normalizeHeadState = (value: unknown): HeadState | null => {
  if (!isRecord(value)) return null

  const sortType = value.sortType
  const textState = value.textState

  return {
    ...DEFAULT_HEAD_STATE,
    open: typeof value.open === 'boolean' ? value.open : undefined,
    showType:
      typeof value.showType === 'boolean'
        ? value.showType
        : DEFAULT_HEAD_STATE.showType,
    sortType: sortType === 1 || sortType === 2 ? sortType : 0,
    filterText:
      typeof value.filterText === 'string'
        ? value.filterText
        : DEFAULT_HEAD_STATE.filterText,
    filterMatchCase:
      typeof value.filterMatchCase === 'boolean'
        ? value.filterMatchCase
        : DEFAULT_HEAD_STATE.filterMatchCase,
    filterMatchWholeWord:
      typeof value.filterMatchWholeWord === 'boolean'
        ? value.filterMatchWholeWord
        : DEFAULT_HEAD_STATE.filterMatchWholeWord,
    filterUseRegularExpression:
      typeof value.filterUseRegularExpression === 'boolean'
        ? value.filterUseRegularExpression
        : DEFAULT_HEAD_STATE.filterUseRegularExpression,
    textState:
      textState === 'url' || textState === 'filter'
        ? textState
        : DEFAULT_HEAD_STATE.textState,
    testUrl:
      typeof value.testUrl === 'string'
        ? value.testUrl
        : DEFAULT_HEAD_STATE.testUrl,
  }
}

const normalizeHeadStatesByProfile = (value: unknown): HeadStateStorage => {
  if (!isRecord(value)) return {}

  return Object.entries(value).reduce<HeadStateStorage>(
    (profiles, [profile, groups]) => {
      if (!isRecord(groups)) return profiles

      const groupStates = Object.entries(groups).reduce<
        Record<string, HeadState>
      >((states, [groupName, headState]) => {
        const normalized = normalizeHeadState(headState)
        if (normalized) {
          states[groupName] = normalized
        }
        return states
      }, {})

      profiles[profile] = groupStates
      return profiles
    },
    {},
  )
}

const readLegacyChainMode = () =>
  getStorageItem(LEGACY_CHAIN_MODE_KEY) === 'true'

const readLegacyProxyChainItems = () =>
  normalizeProxyChainItems(parseStorageJson<unknown>(LEGACY_CHAIN_ITEMS_KEY))

const readLegacyScrollPositions = () =>
  normalizeScrollPositions(
    parseStorageJson<unknown>(LEGACY_SCROLL_POSITIONS_KEY),
  )

const readLegacyHeadStates = () =>
  normalizeHeadStatesByProfile(parseStorageJson<unknown>(LEGACY_HEAD_STATE_KEY))

const createInitialPersistedState = (): ProxyUiPersistedState => ({
  chainModeEnabled: readLegacyChainMode(),
  proxyChainItems: readLegacyProxyChainItems(),
  chainTargetGroup: asOptionalString(getStorageItem(LEGACY_CHAIN_GROUP_KEY)),
  chainExitNode: asOptionalString(getStorageItem(LEGACY_CHAIN_EXIT_NODE_KEY)),
  scrollPositions: readLegacyScrollPositions(),
  headStatesByProfile: readLegacyHeadStates(),
})

const normalizePersistedState = (
  value: unknown,
): Partial<ProxyUiPersistedState> => {
  if (!isRecord(value)) return {}

  return {
    chainModeEnabled:
      typeof value.chainModeEnabled === 'boolean'
        ? value.chainModeEnabled
        : readLegacyChainMode(),
    proxyChainItems: normalizeProxyChainItems(value.proxyChainItems),
    chainTargetGroup:
      asOptionalString(value.chainTargetGroup) ??
      asOptionalString(getStorageItem(LEGACY_CHAIN_GROUP_KEY)),
    chainExitNode:
      asOptionalString(value.chainExitNode) ??
      asOptionalString(getStorageItem(LEGACY_CHAIN_EXIT_NODE_KEY)),
    scrollPositions: normalizeScrollPositions(value.scrollPositions),
    headStatesByProfile: normalizeHeadStatesByProfile(
      value.headStatesByProfile,
    ),
  }
}

export const useProxyUiStore = create<ProxyUiStoreState>()(
  persist(
    (set) => ({
      ...createInitialPersistedState(),
      chainConfigData: null,
      selectedGroup: null,
      setChainModeEnabled: (enabled) =>
        set((state) => ({
          chainModeEnabled: enabled,
          chainConfigData: enabled ? state.chainConfigData : null,
        })),
      setChainConfigData: (chainConfigData) => set({ chainConfigData }),
      setProxyChainItems: (value) =>
        set((state) => ({
          proxyChainItems: resolveStateAction(value, state.proxyChainItems),
        })),
      setSelectedGroup: (selectedGroup) => set({ selectedGroup }),
      setChainConnection: (chainTargetGroup, chainExitNode) =>
        set({ chainTargetGroup, chainExitNode }),
      clearChainConnection: () =>
        set({ chainTargetGroup: null, chainExitNode: null }),
      clearProxyChain: () =>
        set({
          proxyChainItems: [],
          chainTargetGroup: null,
          chainExitNode: null,
          chainConfigData: null,
        }),
      setScrollPosition: (mode, scrollTop) =>
        set((state) => ({
          scrollPositions: {
            ...state.scrollPositions,
            [mode]: scrollTop,
          },
        })),
      setHeadState: (profile, groupName, patch) =>
        set((state) => {
          const profileStates = state.headStatesByProfile[profile] ?? {}
          const previous = profileStates[groupName] ?? DEFAULT_HEAD_STATE

          return {
            headStatesByProfile: {
              ...state.headStatesByProfile,
              [profile]: {
                ...profileStates,
                [groupName]: {
                  ...previous,
                  ...patch,
                },
              },
            },
          }
        }),
      resetHeadState: (profile) =>
        set((state) => {
          const { [profile]: _removed, ...headStatesByProfile } =
            state.headStatesByProfile

          return { headStatesByProfile }
        }),
    }),
    {
      name: PROXY_UI_STORAGE_KEY,
      version: PROXY_UI_STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        chainModeEnabled: state.chainModeEnabled,
        proxyChainItems: state.proxyChainItems,
        chainTargetGroup: state.chainTargetGroup,
        chainExitNode: state.chainExitNode,
        scrollPositions: state.scrollPositions,
        headStatesByProfile: state.headStatesByProfile,
      }),
      migrate: (persistedState) => normalizePersistedState(persistedState),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedState(persistedState),
      }),
    },
  ),
)

export const useProxyChainModeEnabled = () =>
  useProxyUiStore((state) => state.chainModeEnabled)

export const useSetProxyChainModeEnabled = () =>
  useProxyUiStore((state) => state.setChainModeEnabled)

export const useProxyChainConfigData = () =>
  useProxyUiStore((state) => state.chainConfigData)

export const useSetProxyChainConfigData = () =>
  useProxyUiStore((state) => state.setChainConfigData)

export const useProxyChainItems = () =>
  useProxyUiStore((state) => state.proxyChainItems)

export const useSetProxyChainItems = () =>
  useProxyUiStore((state) => state.setProxyChainItems)

export const useProxySelectedGroup = () =>
  useProxyUiStore((state) => state.selectedGroup)

export const useSetProxySelectedGroup = () =>
  useProxyUiStore((state) => state.setSelectedGroup)

export const useProxyChainExitNode = () =>
  useProxyUiStore((state) => state.chainExitNode)

export const useSetProxyChainConnection = () =>
  useProxyUiStore((state) => state.setChainConnection)

export const useClearProxyChainConnection = () =>
  useProxyUiStore((state) => state.clearChainConnection)

export const useClearProxyChain = () =>
  useProxyUiStore((state) => state.clearProxyChain)

export const useSetProxyScrollPosition = () =>
  useProxyUiStore((state) => state.setScrollPosition)

export const getProxyScrollPosition = (mode: string) =>
  useProxyUiStore.getState().scrollPositions[mode]

export const getProxyChainTargetGroup = () =>
  useProxyUiStore.getState().chainTargetGroup

export const useProxyHeadStates = (profile: string) =>
  useProxyUiStore(
    (state) => state.headStatesByProfile[profile] ?? EMPTY_HEAD_STATES,
  )

export const useSetProxyHeadState = () =>
  useProxyUiStore((state) => state.setHeadState)
