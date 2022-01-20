import { atom } from "recoil";

export const atomPaletteMode = atom<"light" | "dark">({
  key: "atomPaletteMode",
  default: "light",
});

export const atomThemeBlur = atom<boolean>({
  key: "atomThemeBlur",
  default: false,
});

export const atomClashPort = atom<number>({
  key: "atomClashPort",
  default: 0,
});
