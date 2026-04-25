import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark'

type SetStateAction<T> = T | ((prev: T) => T)

interface UiStoreState {
  themeMode: ThemeMode
  loadingCache: Record<string, boolean>
  updateState: boolean
  setThemeMode: (mode: ThemeMode) => void
  setLoadingCache: (value: SetStateAction<Record<string, boolean>>) => void
  setUpdateState: (value: SetStateAction<boolean>) => void
}

const resolveStateAction = <T>(value: SetStateAction<T>, previous: T): T =>
  typeof value === 'function' ? (value as (prev: T) => T)(previous) : value

export const useUiStore = create<UiStoreState>()((set) => ({
  themeMode: 'light',
  loadingCache: {},
  updateState: false,
  setThemeMode: (themeMode) => set({ themeMode }),
  setLoadingCache: (value) =>
    set((state) => ({
      loadingCache: resolveStateAction(value, state.loadingCache),
    })),
  setUpdateState: (value) =>
    set((state) => ({
      updateState: resolveStateAction(value, state.updateState),
    })),
}))

export const initializeUiStore = (initialThemeMode: ThemeMode) => {
  useUiStore.setState({ themeMode: initialThemeMode })
}

export const useThemeMode = () => useUiStore((state) => state.themeMode)

export const useSetThemeMode = () => useUiStore((state) => state.setThemeMode)

export const useLoadingCache = () => useUiStore((state) => state.loadingCache)

export const useSetLoadingCache = () =>
  useUiStore((state) => state.setLoadingCache)

export const useUpdateState = () => useUiStore((state) => state.updateState)

export const useSetUpdateState = () =>
  useUiStore((state) => state.setUpdateState)
