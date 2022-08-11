/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />
import "./assets/styles/index.scss";

import React from "react";
import ReactDOM from "react-dom";
import { RecoilRoot } from "recoil";
import { BrowserRouter } from "react-router-dom";
import Layout from "./pages/_layout";
import "./services/i18n";

ReactDOM.render(
  <React.StrictMode>
    <RecoilRoot>
      <BrowserRouter>
        <Layout />
      </BrowserRouter>
    </RecoilRoot>
  </React.StrictMode>,
  document.getElementById("root")
);
