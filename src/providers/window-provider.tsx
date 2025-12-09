import { getCurrentWindow } from "@tauri-apps/api/window";
import { PropsWithChildren, useEffect, useMemo, useState } from "react";

import debounce from "@/utils/debounce";

import { WindowContext } from "./window-context";

const currentWindow = getCurrentWindow();
const initialState: Pick<WindowContextType, "decorated" | "maximized"> = {
  decorated: null,
  maximized: null,
};

export const WindowProvider = ({ children }: PropsWithChildren) => {
  const [state, setState] =
    useState<Pick<WindowContextType, "decorated" | "maximized">>(initialState);

  useEffect(() => {
    let isUnmounted = false;

    const syncState = async () => {
      const [decorated, maximized] = await Promise.all([
        currentWindow.isDecorated(),
        currentWindow.isMaximized(),
      ]);

      if (!isUnmounted) {
        setState({ decorated, maximized });
      }
    };

    const syncMaximized = debounce(async () => {
      if (!isUnmounted) {
        const maximized = await currentWindow.isMaximized();
        setState((prev) => ({ ...prev, maximized }));
      }
    }, 300);

    currentWindow.setMinimizable?.(true);
    void syncState();

    const unlistenPromise = currentWindow.onResized(syncMaximized);

    return () => {
      isUnmounted = true;
      unlistenPromise
        .then((unlisten) => unlisten())
        .catch((err) =>
          console.warn("[WindowProvider] Failed to clean up listeners:", err),
        );
    };
  }, []);

  const actions = useMemo(() => {
    const refreshDecorated = async () => {
      const decorated = await currentWindow.isDecorated();
      setState((prev) => ({ ...prev, decorated }));
      return decorated;
    };

    const toggleDecorations = async () => {
      const next = !(await currentWindow.isDecorated());
      await currentWindow.setDecorations(next);
      setState((prev) => ({ ...prev, decorated: next }));
    };

    const toggleMaximize = async () => {
      const isMaximized = await currentWindow.isMaximized();
      if (isMaximized) {
        await currentWindow.unmaximize();
      } else {
        await currentWindow.maximize();
      }
      setState((prev) => ({ ...prev, maximized: !isMaximized }));
    };

    const toggleFullscreen = async () => {
      const isFullscreen = await currentWindow.isFullscreen();
      await currentWindow.setFullscreen(!isFullscreen);
    };

    return {
      minimize: () => currentWindow.minimize(),
      close: () => currentWindow.close(),
      refreshDecorated,
      toggleDecorations,
      toggleMaximize,
      toggleFullscreen,
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      ...state,
      ...actions,
      currentWindow,
    }),
    [state, actions],
  );

  return <WindowContext value={contextValue}>{children}</WindowContext>;
};
