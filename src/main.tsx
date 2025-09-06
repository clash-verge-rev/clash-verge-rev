/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />
import "./assets/styles/index.scss";

import { ResizeObserver } from "@juggle/resize-observer";
if (!window.ResizeObserver) {
  window.ResizeObserver = ResizeObserver;
}

import React from "react";
import { createRoot } from "react-dom/client";
import { ComposeContextProvider } from "foxact/compose-context-provider";
import { BrowserRouter } from "react-router-dom";
import { BaseErrorBoundary } from "./components/base";
import Layout from "./pages/_layout";
import { initializeLanguage } from "./services/i18n";
import {
  LoadingCacheProvider,
  ThemeModeProvider,
  UpdateStateProvider,
} from "./services/states";
import { AppDataProvider } from "./providers/app-data-provider";

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

const initializeApp = async () => {
  try {
    await initializeLanguage("zh");

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
            <AppDataProvider>
              <BrowserRouter>
                <Layout />
              </BrowserRouter>
            </AppDataProvider>
          </BaseErrorBoundary>
        </ComposeContextProvider>
      </React.StrictMode>,
    );
  } catch (error) {
    console.error("[main.tsx] 应用初始化失败:", error);
    const root = createRoot(container);
    root.render(
      <div style={{ padding: "20px", color: "red" }}>
        应用初始化失败: {error instanceof Error ? error.message : String(error)}
      </div>,
    );
  }
};

initializeApp();

// 错误处理
window.addEventListener("error", (event) => {
  console.error("[main.tsx] 全局错误:", event.error);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[main.tsx] 未处理的Promise拒绝:", event.reason);
});
