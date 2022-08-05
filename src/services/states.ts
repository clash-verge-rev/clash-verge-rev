import { atom } from "recoil";

export const atomThemeMode = atom<"light" | "dark">({
  key: "atomThemeMode",
  default: "light",
});

export const atomClashPort = atom<number>({
  key: "atomClashPort",
  default: 0,
});

export const atomLogData = atom<ApiType.LogItem[]>({
  key: "atomLogData",
  default: [],
});

// save the state of each profile item loading
export const atomLoadingCache = atom<Record<string, boolean>>({
  key: "atomLoadingCache",
  default: {},
});

// save update state
export const atomUpdateState = atom<boolean>({
  key: "atomUpdateState",
  default: false,
});

// current profile uid
export const atomCurrentProfile = atom<string>({
  key: "atomCurrentProfile",
  default: "",
});
