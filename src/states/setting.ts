import { atom } from "recoil";

export const atomClashPort = atom<number>({
  key: "atomClashPort",
  default: 0,
});
