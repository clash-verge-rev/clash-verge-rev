import { getCurrentWindow } from "@tauri-apps/api/window";
import React, {
  createContext,
  useCallback,
  use,
  useEffect,
  useState,
} from "react";

interface WindowContextType {
  decorated: boolean | null;
  maximized: boolean | null;
  toggleDecorations: () => Promise<void>;
  refreshDecorated: () => Promise<boolean>;
  minimize: () => void;
  close: () => void;
  toggleMaximize: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
  currentWindow: ReturnType<typeof getCurrentWindow>;
}

const WindowContext = createContext<WindowContextType | undefined>(undefined);

export const WindowProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const currentWindow = getCurrentWindow();
  const [decorated, setDecorated] = useState<boolean | null>(null);
  const [maximized, setMaximized] = useState<boolean | null>(null);

  const close = useCallback(() => currentWindow.close(), [currentWindow]);
  const minimize = useCallback(() => currentWindow.minimize(), [currentWindow]);

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

  return (
    <WindowContext
      value={{
        decorated,
        maximized,
        toggleDecorations,
        refreshDecorated,
        minimize,
        close,
        toggleMaximize,
        toggleFullscreen,
        currentWindow,
      }}
    >
      {children}
    </WindowContext>
  );
};

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
  };
};

export const useWindowDecorations = () => {
  const { decorated, toggleDecorations, refreshDecorated } = useWindow();
  return { decorated, toggleDecorations, refreshDecorated };
};
