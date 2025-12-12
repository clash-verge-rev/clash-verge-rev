import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import debounce from "@/utils/debounce";

import { WindowContext } from "./WindowContext";

export const WindowProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [decorated, setDecorated] = useState<boolean | null>(null);
  const [maximized, setMaximized] = useState<boolean | null>(null);

  const close = useCallback(async () => {
    // Delay one frame so the UI can clear :hover before the window hides.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await currentWindow.close();
  }, [currentWindow]);
  const minimize = useCallback(async () => {
    // Delay one frame so the UI can clear :hover before the window hides.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await currentWindow.minimize();
  }, [currentWindow]);

  useEffect(() => {
    let isUnmounted = false;

    const checkMaximized = debounce(async () => {
      if (!isUnmounted) {
        const value = await currentWindow.isMaximized();
        setMaximized(value);
      }
    }, 300);

    const unlistenPromise = currentWindow.onResized(checkMaximized);

    return () => {
      isUnmounted = true;
      unlistenPromise
        .then((unlisten) => unlisten())
        .catch((err) => console.warn("[WindowProvider] 清理监听器失败:", err));
    };
  }, [currentWindow]);

  const toggleMaximize = useCallback(async () => {
    if (await currentWindow.isMaximized()) {
      await currentWindow.unmaximize();
      setMaximized(false);
    } else {
      await currentWindow.maximize();
      setMaximized(true);
    }
  }, [currentWindow]);

  const toggleFullscreen = useCallback(async () => {
    await currentWindow.setFullscreen(!(await currentWindow.isFullscreen()));
  }, [currentWindow]);

  const refreshDecorated = useCallback(async () => {
    const val = await currentWindow.isDecorated();
    setDecorated(val);
    return val;
  }, [currentWindow]);

  const toggleDecorations = useCallback(async () => {
    const currentVal = await currentWindow.isDecorated();
    await currentWindow.setDecorations(!currentVal);
    setDecorated(!currentVal);
  }, [currentWindow]);

  useEffect(() => {
    refreshDecorated();
    currentWindow.setMinimizable?.(true);
  }, [currentWindow, refreshDecorated]);

  const contextValue = useMemo(
    () => ({
      decorated,
      maximized,
      toggleDecorations,
      refreshDecorated,
      minimize,
      close,
      toggleMaximize,
      toggleFullscreen,
      currentWindow,
    }),
    [
      decorated,
      maximized,
      toggleDecorations,
      refreshDecorated,
      minimize,
      close,
      toggleMaximize,
      toggleFullscreen,
      currentWindow,
    ],
  );

  return <WindowContext value={contextValue}>{children}</WindowContext>;
};
