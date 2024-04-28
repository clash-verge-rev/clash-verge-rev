/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />
import "./assets/styles/index.scss";

import { ResizeObserver } from "@juggle/resize-observer";
if (!window.ResizeObserver) {
  window.ResizeObserver = ResizeObserver;
}

import React from "react";
import { createRoot } from "react-dom/client";
import { RecoilRoot } from "recoil";
import { BrowserRouter } from "react-router-dom";
import { BaseErrorBoundary } from "./components/base";
import Layout from "./pages/_layout";
import "./services/i18n";

const mainElementId = "root";
const container = document.getElementById(mainElementId);

if (!container) {
  throw new Error(
    `No container '${mainElementId}' found to render application`
  );
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

createRoot(container).render(
  <React.StrictMode>
    <RecoilRoot>
      <BaseErrorBoundary>
        <BrowserRouter>
          <Layout />
        </BrowserRouter>
      </BaseErrorBoundary>
    </RecoilRoot>
  </React.StrictMode>
);
