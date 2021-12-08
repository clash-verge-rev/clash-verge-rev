import "./assets/styles/index.scss";

import React from "react";
import ReactDOM from "react-dom";
import { BrowserRouter } from "react-router-dom";
import { createTheme, ThemeProvider } from "@mui/material";
import Layout from "./pages/_layout";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#5b5c9d",
    },
    text: {
      primary: "#637381",
      secondary: "#909399",
    },
  },
});

// console.log(theme);

ReactDOM.render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <BrowserRouter>
        <Layout />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
  document.getElementById("root")
);
