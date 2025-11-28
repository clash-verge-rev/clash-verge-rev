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

const initializeApp = () => {
  const contexts = [
    <ThemeModeProvider key="theme" />,
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

const determineInitialLanguage = async () => {
  const cachedLanguage = getCachedLanguage();
  if (cachedLanguage) {
    return cachedLanguage;
  }

  try {
    const vergeConfig = await getVergeConfig();
    if (vergeConfig?.language) {
      const resolved = resolveLanguage(vergeConfig.language);
      cacheLanguage(resolved);
      return resolved;
    }
  } catch (error) {
    console.warn(
      "[main.tsx] Failed to read language from Verge config:",
      error,
    );
  }

  const browserLanguage = resolveLanguage(
    typeof navigator !== "undefined" ? navigator.language : undefined,
  );
  cacheLanguage(browserLanguage);
  return browserLanguage;
};

const bootstrap = async () => {
  const initialLanguage = await determineInitialLanguage();
  await initializeLanguage(initialLanguage);
  initializeApp();
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
      initializeApp();
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
