import "./assets/styles/index.scss";

import React from "react";
import ReactDOM from "react-dom";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import HomePage from "./pages/home";
import ProfilesPage from "./pages/profiles";
import { version } from "../package.json";

function Layout() {
  return (
    <div className="layout">
      <div className="layout__sidebar">
        <h1>Clash Verge</h1>
        <h3>{version}</h3>

        <div className="layout__links">
          <NavLink to="/">Home</NavLink>
          <NavLink to="/profiles">Profiles</NavLink>
        </div>
      </div>

      <div className="layout__content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/profiles" element={<ProfilesPage />} />
        </Routes>
      </div>
    </div>
  );
}

ReactDOM.render(
  <React.StrictMode>
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  </React.StrictMode>,
  document.getElementById("root")
);
