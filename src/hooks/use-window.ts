import { use, useMemo } from "react";

import { WindowContext } from "@/providers/window-context";

const controlKeys = [
  "maximized",
  "minimize",
  "toggleMaximize",
  "close",
  "toggleFullscreen",
  "currentWindow",
] as const;

const decorationKeys = [
  "decorated",
  "toggleDecorations",
  "refreshDecorated",
] as const;

const pickWindowValues = <K extends keyof WindowContextType>(
  context: WindowContextType,
  keys: readonly K[],
) =>
  keys.reduce(
    (result, key) => {
      result[key] = context[key];
      return result;
    },
    {} as Pick<WindowContextType, K>,
  );

const useWindowContext = () => {
  const context = use(WindowContext);
  if (!context) {
    throw new Error("useWindowContext must be used within WindowProvider");
  }
  return context;
};

export const useWindowControls = () => {
  const context = useWindowContext();
  return useMemo(() => pickWindowValues(context, controlKeys), [context]);
};

export const useWindowDecorations = () => {
  const context = useWindowContext();
  return useMemo(() => pickWindowValues(context, decorationKeys), [context]);
};
