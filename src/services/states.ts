import { createContextState } from "foxact/create-context-state";
import { useLocalStorage } from "foxact/use-local-storage";

const [ThemeModeProvider, useThemeMode, useSetThemeMode] = createContextState<
  "light" | "dark"
>("light");

interface ThemeSettings {
  light: IVergeConfig["light_theme_setting"];
  dark: IVergeConfig["dark_theme_setting"];
}
const defaultThemeSettings: ThemeSettings = {
  light: {},
  dark: {},
};
export const useThemeSettings = () =>
  useLocalStorage<ThemeSettings>("theme_settings", defaultThemeSettings, {
    serializer: JSON.stringify,
    deserializer: JSON.parse,
  });

interface IClashLog {
  enable: boolean;
  logLevel: "debug" | "info" | "warning" | "error" | "silent";
  logFilter: "all" | "inf" | "warn" | "err";
}
const defaultClashLog: IClashLog = {
  enable: true,
  logLevel: "info",
  logFilter: "all",
};
export const useClashLog = () =>
  useLocalStorage<IClashLog>("clash-log", defaultClashLog, {
    serializer: JSON.stringify,
    deserializer: JSON.parse,
  });

interface IConnectionSetting {
  layout: "table" | "list";
}
const defaultConnectionSetting: IConnectionSetting = { layout: "table" };
export const useConnectionSetting = () =>
  useLocalStorage<IConnectionSetting>(
    "connections-setting",
    defaultConnectionSetting,
    {
      serializer: JSON.stringify,
      deserializer: JSON.parse,
    },
  );

// save the state of each profile item loading
const [LoadingCacheProvider, useLoadingCache, useSetLoadingCache] =
  createContextState<Record<string, boolean>>({});

// save update state
const [UpdateStateProvider, useUpdateState, useSetUpdateState] =
  createContextState<boolean>(false);

export {
  LoadingCacheProvider,
  ThemeModeProvider,
  UpdateStateProvider,
  useLoadingCache,
  useSetLoadingCache,
  useSetThemeMode,
  useSetUpdateState,
  useThemeMode,
  useUpdateState,
};
