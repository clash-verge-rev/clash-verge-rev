import {
  BaseErrorBoundary,
  MyNoticeContainer,
  NoticeProvider,
} from "@/components/base";
import "@/index.css";
import router from "@/pages/_routers";
import "@/services/i18n";
import { ResizeObserver } from "@juggle/resize-observer";
import { StyledEngineProvider } from "@mui/material";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ComposeContextProvider } from "foxact/compose-context-provider";
import { SnackbarProvider } from "notistack";
import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import {
  LoadingCacheProvider,
  ThemeModeProvider,
  UpdateStateProvider,
} from "./services/states";
import { WebSocket } from "tauri-plugin-mihomo-api";

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

if (process.env.NODE_ENV !== "development") {
  // disable context menu
  document.addEventListener("contextmenu", (event) => {
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

document.addEventListener("DOMContentLoaded", async () => {
  const splashscreenWindow = await WebviewWindow.getByLabel("splashscreen");
  if (splashscreenWindow) {
    setTimeout(() => {
      splashscreenWindow.close();
    }, 1000);
  }
});

// 页面关闭/刷新事件
window.addEventListener("beforeunload", () => {
  WebSocket.cleanupAll(); // 强制清理所有 WebSocket 实例
});

const contexts = [
  <ThemeModeProvider key={"themeModeProvider"} />,
  <LoadingCacheProvider key={"loadingCacheProvider"} />,
  <UpdateStateProvider key={"updateStateProvider"} />,
];

createRoot(container).render(
  <React.StrictMode>
    <StyledEngineProvider injectFirst>
      <ComposeContextProvider contexts={contexts}>
        <BaseErrorBoundary>
          <SnackbarProvider
            maxSnack={3}
            Components={{
              default: MyNoticeContainer,
              success: MyNoticeContainer,
              info: MyNoticeContainer,
              warning: MyNoticeContainer,
              error: MyNoticeContainer,
            }}>
            <NoticeProvider>
              <RouterProvider router={router} />
            </NoticeProvider>
          </SnackbarProvider>
        </BaseErrorBoundary>
      </ComposeContextProvider>
    </StyledEngineProvider>
  </React.StrictMode>,
);
