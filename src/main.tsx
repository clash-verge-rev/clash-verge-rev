/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />
import "@/assets/styles/index.scss";

import { ResizeObserver } from "@juggle/resize-observer";
if (!window.ResizeObserver) {
  window.ResizeObserver = ResizeObserver;
}

import React from "react";
import { createRoot } from "react-dom/client";
import { ComposeContextProvider } from "foxact/compose-context-provider";
import { RouterProvider } from "react-router-dom";
import { BaseErrorBoundary } from "@/components/base";
import Layout from "@/pages/_layout";
import "@/services/i18n";
import { invoke } from "@tauri-apps/api/tauri";
import { WebviewWindow } from "@tauri-apps/api/window";
import {
  LoadingCacheProvider,
  ThemeModeProvider,
  UpdateStateProvider,
} from "./services/states";
import router from "@/pages/_routers";

const mainElementId = "root";
const container = document.getElementById(mainElementId);

if (!container) {
  throw new Error(
    `No container '${mainElementId}' found to render application`,
  );
}

if (process.env.NODE_ENV !== "development") {
  // disable context menu
  document.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });
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
  disabledShortcuts && event.preventDefault();
});

document.addEventListener("DOMContentLoaded", () => {
  // close splashscreen window here, but first we need to check if the clash program is avaliable
  let checkCount = 10;
  const splashscreenWindow = WebviewWindow.getByLabel("splashscreen");
  if (splashscreenWindow) {
    const timer = setInterval(async () => {
      const clashStartSuccess = await invoke<boolean>("get_clash_configs");
      if (clashStartSuccess || checkCount < 0) {
        clearInterval(timer);
        splashscreenWindow.close();
        throw new Error("clash core start failed, please restart the app");
      }
      checkCount--;
    }, 1000);
  }
});

const contexts = [
  <ThemeModeProvider />,
  <LoadingCacheProvider />,
  <UpdateStateProvider />,
];

createRoot(container).render(
  <React.StrictMode>
    <ComposeContextProvider contexts={contexts}>
      <BaseErrorBoundary>
        <RouterProvider router={router} />
      </BaseErrorBoundary>
    </ComposeContextProvider>
  </React.StrictMode>,
);
