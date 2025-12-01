import { createContext, use } from "react";

import { darkColors } from "./colors";
import { ColorScheme } from "./types";

// Color context
export const ColorContext = createContext<ColorScheme>(darkColors);
export const useColors = () => use(ColorContext);

// Text menu context
export interface TextMenuContextValue {
  showMenu: (e: React.MouseEvent, text: string) => void;
}

export const TextMenuContext = createContext<TextMenuContextValue | null>(null);

export const useTextMenu = () => {
  const ctx = use(TextMenuContext);
  if (!ctx) throw new Error("useTextMenu must be used within ConsolePanel");
  return ctx;
};
