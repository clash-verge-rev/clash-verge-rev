import { useEffect, useMemo } from "react";
import { alpha, createTheme, Shadows, Theme } from "@mui/material";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useSetThemeMode, useThemeMode } from "@/services/states";
import { defaultTheme, defaultDarkTheme } from "@/pages/_theme";
import { useVerge } from "@/hooks/use-verge";
import {
  zhCN as zhXDataGrid,
  enUS as enXDataGrid,
  ruRU as ruXDataGrid,
  faIR as faXDataGrid,
  arSD as arXDataGrid,
} from "@mui/x-data-grid/locales";
import { useTranslation } from "react-i18next";
const appWindow = getCurrentWebviewWindow();

const languagePackMap: Record<string, any> = {
  zh: { ...zhXDataGrid },
  fa: { ...faXDataGrid },
  ru: { ...ruXDataGrid },
  ar: { ...arXDataGrid },
  en: { ...enXDataGrid },
};

const getLanguagePackMap = (key: string) =>
  languagePackMap[key] || languagePackMap.en;

/**
 * custom theme
 */
export const useCustomTheme = () => {
  const { verge } = useVerge();
  const { i18n } = useTranslation();
  const { theme_mode, theme_setting } = verge ?? {};
  const mode = useThemeMode();
  const setMode = useSetThemeMode();

  useEffect(() => {
    const themeMode = ["light", "dark", "system"].includes(theme_mode!)
      ? theme_mode!
      : "light";

    if (themeMode !== "system") {
      setMode(themeMode);
      return;
    }

    appWindow.theme().then((m) => m && setMode(m));
    const unlisten = appWindow.onThemeChanged((e) => setMode(e.payload));

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [theme_mode]);

  const theme = useMemo(() => {
    const setting = theme_setting || {};
    const dt = mode === "light" ? defaultTheme : defaultDarkTheme;

    let theme: Theme;

    try {
      theme = createTheme(
        {
          breakpoints: {
            values: { xs: 0, sm: 650, md: 900, lg: 1200, xl: 1536 },
          },
          palette: {
            mode,
            primary: { main: setting.primary_color || dt.primary_color },
            secondary: { main: setting.secondary_color || dt.secondary_color },
            info: { main: setting.info_color || dt.info_color },
            error: { main: setting.error_color || dt.error_color },
            warning: { main: setting.warning_color || dt.warning_color },
            success: { main: setting.success_color || dt.success_color },
            text: {
              primary: setting.primary_text || dt.primary_text,
              secondary: setting.secondary_text || dt.secondary_text,
            },
            background: {
              paper: dt.background_color,
            },
          },
          shadows: Array(25).fill("none") as Shadows,
          typography: {
            // todo
            fontFamily: setting.font_family
              ? `${setting.font_family}, ${dt.font_family}`
              : dt.font_family,
          },
        },
        getLanguagePackMap(i18n.language),
      );
    } catch {
      // fix #294
      theme = createTheme({
        breakpoints: {
          values: { xs: 0, sm: 650, md: 900, lg: 1200, xl: 1536 },
        },
        palette: {
          mode,
          primary: { main: dt.primary_color },
          secondary: { main: dt.secondary_color },
          info: { main: dt.info_color },
          error: { main: dt.error_color },
          warning: { main: dt.warning_color },
          success: { main: dt.success_color },
          text: { primary: dt.primary_text, secondary: dt.secondary_text },
        },
        typography: { fontFamily: dt.font_family },
      });
    }

    // css
    const backgroundColor = mode === "light" ? "#ECECEC" : "#2e303d";
    const selectColor = mode === "light" ? "#f5f5f5" : "#d5d5d5";
    const scrollColor = mode === "light" ? "#90939980" : "#3E3E3Eee";
    const dividerColor =
      mode === "light" ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.06)";

    const rootEle = document.documentElement;
    rootEle.style.setProperty("--divider-color", dividerColor);
    rootEle.style.setProperty("--background-color", backgroundColor);
    rootEle.style.setProperty("--selection-color", selectColor);
    rootEle.style.setProperty("--scroller-color", scrollColor);
    rootEle.style.setProperty("--primary-main", theme.palette.primary.main);
    rootEle.style.setProperty(
      "--background-color-alpha",
      alpha(theme.palette.primary.main, 0.1),
    );

    // inject css
    let style = document.querySelector("style#verge-theme");
    if (!style) {
      style = document.createElement("style");
      style.id = "verge-theme";
      document.head.appendChild(style!);
    }
    if (style) {
      style.innerHTML = setting.css_injection || "";
    }

    // update svg icon
    const { palette } = theme;

    setTimeout(() => {
      const dom = document.querySelector("#Gradient2");
      if (dom) {
        dom.innerHTML = `
        <stop offset="0%" stop-color="${palette.primary.main}" />
        <stop offset="80%" stop-color="${palette.primary.dark}" />
        <stop offset="100%" stop-color="${palette.primary.dark}" />
        `;
      }
    }, 0);

    return theme;
  }, [mode, theme_setting, i18n.language]);

  return { theme };
};
