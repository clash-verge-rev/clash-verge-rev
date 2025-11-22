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
import { initializeLanguage } from "./services/i18n";
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

initializeLanguage("zh").catch(console.error);
initializeApp();

// 错误处理
window.addEventListener("error", (event) => {
  console.error("[main.tsx] 全局错误:", event.error);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[main.tsx] 未处理的Promise拒绝:", event.reason);
});

// 页面关闭/刷新事件
window.addEventListener("beforeunload", () => {
  // 同步清理所有 WebSocket 实例, 防止内存泄漏
  MihomoWebSocket.cleanupAll();
});
