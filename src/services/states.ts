import { createContextState } from 'foxact/create-context-state'

const [ThemeModeProvider, useThemeMode, useSetThemeMode] = createContextState<
  'light' | 'dark'
>()

// save update state
const [UpdateStateProvider, useUpdateState, useSetUpdateState] =
  createContextState<boolean>(false)

export {
  ThemeModeProvider,
  useThemeMode,
  useSetThemeMode,
  UpdateStateProvider,
  useUpdateState,
  useSetUpdateState,
}
