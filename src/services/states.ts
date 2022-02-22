import { atom } from "recoil";
import { ApiType } from "./types";

export const atomClashPort = atom<number>({
  key: "atomClashPort",
  default: 0,
});

export const atomLogData = atom<ApiType.LogItem[]>({
  key: "atomLogData",
  default: [],
});
