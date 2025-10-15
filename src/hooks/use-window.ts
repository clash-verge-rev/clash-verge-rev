import { use } from "react";

import { WindowContext, type WindowContextType } from "@/providers/window";

export const useWindow = () => {
  const context = use(WindowContext);
  if (context === undefined) {
    throw new Error("useWindow must be used within WindowProvider");
  }
  return context;
};

export const useWindowControls = () => {
  const {
    maximized,
    minimize,
    toggleMaximize,
    close,
    toggleFullscreen,
    currentWindow,
  } = useWindow();
  return {
    maximized,
    minimize,
    toggleMaximize,
    close,
    toggleFullscreen,
    currentWindow,
  } satisfies Pick<
    WindowContextType,
    | "maximized"
    | "minimize"
    | "toggleMaximize"
    | "close"
    | "toggleFullscreen"
    | "currentWindow"
  >;
};

export const useWindowDecorations = () => {
  const { decorated, toggleDecorations, refreshDecorated } = useWindow();
  return { decorated, toggleDecorations, refreshDecorated } satisfies Pick<
    WindowContextType,
    "decorated" | "toggleDecorations" | "refreshDecorated"
  >;
};
