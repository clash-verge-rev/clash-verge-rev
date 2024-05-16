/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />
import "@/assets/styles/index.scss";

import { ResizeObserver } from "@juggle/resize-observer";
if (!window.ResizeObserver) {
  window.ResizeObserver = ResizeObserver;
}

import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { RecoilRoot } from "recoil";
import { BrowserRouter } from "react-router-dom";
import { BaseErrorBoundary } from "@/components/base";
import Layout from "@/pages/_layout";
import "@/services/i18n";
import { invoke } from "@tauri-apps/api/tauri";
import { WebviewWindow } from "@tauri-apps/api/window";

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
  if (["F5", "F7"].includes(event.key)) {
    event.preventDefault();
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    ["F", "H", "P", "R", "U"].includes(event.key.toUpperCase())
  ) {
    event.preventDefault();
  }
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

createRoot(container).render(
  <React.StrictMode>
    <RecoilRoot>
      <BaseErrorBoundary>
        <BrowserRouter>
          <Layout />
        </BrowserRouter>
      </BaseErrorBoundary>
    </RecoilRoot>
  </React.StrictMode>,
);
