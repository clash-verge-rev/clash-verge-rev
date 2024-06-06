import { atom } from "recoil";
import { createContextState } from "foxact/create-context-state";
import { useLocalStorage } from "foxact/use-local-storage";

const [ThemeModeProvider, useThemeMode, useSetThemeMode] = createContextState<
  "light" | "dark"
>("light");

const [LogDataProvider, useLogData, useSetLogData] = createContextState<
  ILogItem[]
>([]);

export const useEnableLog = () => useLocalStorage("enable-log", true);

interface IConnectionSetting {
  layout: "table" | "list";
}

export const atomConnectionSetting = atom<IConnectionSetting>({
  key: "atomConnectionSetting",
  effects: [
    ({ setSelf, onSet }) => {
      const key = "connections-setting";

      try {
        const value = localStorage.getItem(key);
        const data = value == null ? { layout: "table" } : JSON.parse(value);
        setSelf(data);
      } catch {
        setSelf({ layout: "table" });
      }

      onSet((newValue) => {
        try {
          localStorage.setItem(key, JSON.stringify(newValue));
        } catch {}
      });
    },
  ],
});

// save the state of each profile item loading
const [LoadingCacheProvider, useLoadingCache, useSetLoadingCache] =
  createContextState<Record<string, boolean>>({});

// save update state
const [UpdateStateProvider, useUpdateState, useSetUpdateState] =
  createContextState<boolean>(false);

export {
  ThemeModeProvider,
  useThemeMode,
  useSetThemeMode,
  LogDataProvider,
  useLogData,
  useSetLogData,
  LoadingCacheProvider,
  useLoadingCache,
  useSetLoadingCache,
  UpdateStateProvider,
  useUpdateState,
  useSetUpdateState,
};
