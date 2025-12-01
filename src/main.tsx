/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />
import "./assets/styles/index.scss";
import "./utils/monaco";

import { ResizeObserver } from "@juggle/resize-observer";
import { ComposeContextProvider } from "foxact/compose-context-provider";
import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { MihomoWebSocket } from "tauri-plugin-mihomo-api";

import { BaseErrorBoundary } from "./components/base";
import { router } from "./pages/_routers";
import { AppDataProvider } from "./providers/app-data-provider";
import { WindowProvider } from "./providers/window";
import { getVergeConfig } from "./services/cmds";
import {
  FALLBACK_LANGUAGE,
  cacheLanguage,
  getCachedLanguage,
  initializeLanguage,
  resolveLanguage,
} from "./services/i18n";
import { setInitialVergeConfig } from "./services/preloaded-verge-config";
import {
  LoadingCacheProvider,
  ThemeModeProvider,
  UpdateStateProvider,
} from "./services/states";

if (!window.ResizeObserver) {
  window.ResizeObserver = ResizeObserver;
}

const mainElementId = "root";
const container = document.getElementById(mainElementId);

if (!container) {
  throw new Error(
    `No container '${mainElementId}' found to render application`,
  );
}

document.addEventListener("keydown", (event) => {
  // Disable WebView keyboard shortcuts
  const disabledShortcuts =
    ["F5", "F7"].includes(event.key) ||
    (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) ||
    ((event.ctrlKey || event.metaKey) &&
      ["F", "G", "H", "J", "P", "Q", "R", "U"].includes(
        event.key.toUpperCase(),
      ));
  if (disabledShortcuts) {
    event.preventDefault();
  }
});

let cachedVergeConfig: IVergeConfig | null = null;

const detectSystemTheme = (): "light" | "dark" => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const getInitialThemeModeFromWindow = ():
  | IVergeConfig["theme_mode"]
  | undefined => {
  if (typeof window === "undefined") return undefined;
  const mode = (
    window as typeof window & {
      __VERGE_INITIAL_THEME_MODE?: unknown;
    }
  ).__VERGE_INITIAL_THEME_MODE;
  if (mode === "light" || mode === "dark" || mode === "system") {
    return mode;
  }
  return undefined;
};

const resolveInitialThemeMode = (
  vergeConfig?: IVergeConfig | null,
): "light" | "dark" => {
  const initialMode =
    vergeConfig?.theme_mode ?? getInitialThemeModeFromWindow();
  if (initialMode === "dark" || initialMode === "light") {
    return initialMode;
  }
  return detectSystemTheme();
};

const initializeApp = (initialThemeMode: "light" | "dark") => {
  const contexts = [
    <ThemeModeProvider key="theme" initialState={initialThemeMode} />,
    <LoadingCacheProvider key="loading" />,
    <UpdateStateProvider key="update" />,
  ];

  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ComposeContextProvider contexts={contexts}>
        <BaseErrorBoundary>
          <WindowProvider>
            <AppDataProvider>
              <RouterProvider router={router} />
            </AppDataProvider>
          </WindowProvider>
        </BaseErrorBoundary>
      </ComposeContextProvider>
    </React.StrictMode>,
  );
};

const determineInitialLanguage = async (
  vergeConfig?: IVergeConfig | null,
  loadVergeConfig?: () => Promise<IVergeConfig | null>,
) => {
  const cachedLanguage = getCachedLanguage();
  if (cachedLanguage) {
    return cachedLanguage;
  }

  let resolvedConfig = vergeConfig;

  if (resolvedConfig === undefined) {
    if (loadVergeConfig) {
      try {
        resolvedConfig = await loadVergeConfig();
      } catch (error) {
        console.warn(
          "[main.tsx] Failed to read language from Verge config:",
          error,
        );
        resolvedConfig = null;
      }
    } else {
      try {
        resolvedConfig = await getVergeConfig();
        cachedVergeConfig = resolvedConfig;
      } catch (error) {
        console.warn(
          "[main.tsx] Failed to read language from Verge config:",
          error,
        );
        resolvedConfig = null;
      }
    }
  }

  const languageFromConfig = resolvedConfig?.language;
  if (languageFromConfig) {
    const resolved = resolveLanguage(languageFromConfig);
    cacheLanguage(resolved);
    return resolved;
  }

  const browserLanguage = resolveLanguage(
    typeof navigator !== "undefined" ? navigator.language : undefined,
  );
  cacheLanguage(browserLanguage);
  return browserLanguage;
};

const fetchVergeConfig = async () => {
  try {
    const config = await getVergeConfig();
    cachedVergeConfig = config;
    setInitialVergeConfig(config);
    return config;
  } catch (error) {
    console.warn("[main.tsx] Failed to read Verge config:", error);
    setInitialVergeConfig(null);
    return null;
  }
};

const bootstrap = async () => {
  const vergeConfigPromise = fetchVergeConfig();
  const initialLanguage = await determineInitialLanguage(
    undefined,
    () => vergeConfigPromise,
  );
  const [vergeConfig] = await Promise.all([
    vergeConfigPromise,
    initializeLanguage(initialLanguage),
  ]);
  const initialThemeMode = resolveInitialThemeMode(vergeConfig);
  initializeApp(initialThemeMode);
};

bootstrap().catch((error) => {
  console.error(
    "[main.tsx] App bootstrap failed, falling back to default language:",
    error,
  );
  initializeLanguage(FALLBACK_LANGUAGE)
    .catch((fallbackError) => {
      console.error(
        "[main.tsx] Fallback language initialization failed:",
        fallbackError,
      );
    })
    .finally(() => {
      initializeApp(resolveInitialThemeMode(cachedVergeConfig));
    });
});

// Error handling
window.addEventListener("error", (event) => {
  console.error("[main.tsx] Global error:", event.error);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[main.tsx] Unhandled promise rejection:", event.reason);
});

// Page close/refresh events
window.addEventListener("beforeunload", () => {
  // Clean up all WebSocket instances to prevent memory leaks
  MihomoWebSocket.cleanupAll();
});
