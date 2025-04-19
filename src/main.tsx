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
import "./services/i18n";
import {
  LoadingCacheProvider,
  ThemeModeProvider,
  UpdateStateProvider,
} from "./services/states";
import { AppDataProvider } from "./providers/app-data-provider";
import { deleteProfile, getProfiles } from "@/services/cmds";
import { AuthProvider } from "./providers/auth-provider";

// 标记初始化完成状态，供其他组件使用
export let appInitialized = false;

const mainElementId = "root";
const container = document.getElementById(mainElementId);

document.addEventListener("keydown", (event) => {
  // Disable WebView keyboard shortcuts
  const disabledShortcuts =
    ["F5", "F7"].includes(event.key) ||
    (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) ||
    ((event.ctrlKey || event.metaKey) &&
      ["F", "G", "H", "J", "P", "Q", "R", "U"].includes(
        event.key.toUpperCase()
      ));
  disabledShortcuts && event.preventDefault();
});

const contexts = [
  <ThemeModeProvider />,
  <LoadingCacheProvider />,
  <UpdateStateProvider />,
];

// Initialize app by deleting all profiles before rendering
async function initializeApp() {
  try {
    // Get all profiles
    const profiles = await getProfiles();
    const items = profiles?.items || [];
    
    // Delete all profiles
    if (items.length > 0) {
      console.log(`Deleting ${items.length} profiles during app initialization...`);
      for (const item of items) {
        if (item && item.uid) {
          await deleteProfile(item.uid);
        }
      }
      console.log("All profiles have been deleted successfully");
    }
    
    // 标记初始化完成
    appInitialized = true;
  } catch (err) {
    console.error("Failed to delete profiles during initialization:", err);
    // 即使出错也标记为初始化完成，以免阻塞后续流程
    appInitialized = true;
  }
}

// Run initialization and then render the app
initializeApp().then(() => {
  createRoot(container!).render(
    <React.StrictMode>
      <ComposeContextProvider contexts={contexts}>
        <BaseErrorBoundary>
          <BrowserRouter>
            <AuthProvider>
              <AppDataProvider>
                <Layout />
              </AppDataProvider>
            </AuthProvider>
          </BrowserRouter>
        </BaseErrorBoundary>
      </ComposeContextProvider>
    </React.StrictMode>
  );
});
