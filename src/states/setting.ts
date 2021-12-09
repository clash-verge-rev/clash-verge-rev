import { atom } from "recoil";

export const atomPaletteMode = atom<"light" | "dark">({
  key: "atomPaletteMode",
  default: "light",
});
