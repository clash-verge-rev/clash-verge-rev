import { getCurrentWindow } from "@tauri-apps/api/window";
import { createContext } from "react";

export interface WindowContextType {
  decorated: boolean | null;
  maximized: boolean | null;
  toggleDecorations: () => Promise<void>;
  refreshDecorated: () => Promise<boolean>;
  minimize: () => Promise<void>;
  close: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
  currentWindow: ReturnType<typeof getCurrentWindow>;
}

export const WindowContext = createContext<WindowContextType | undefined>(
  undefined,
);
