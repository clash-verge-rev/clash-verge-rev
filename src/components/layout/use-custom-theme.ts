import { useVerge } from "@/hooks/use-verge";
import { defaultDarkTheme, defaultTheme } from "@/pages/_theme";
import {
  useSetThemeMode,
  useThemeMode,
  useThemeSettings,
} from "@/services/states";
import getSystem from "@/utils/get-system";
import {
  alpha,
  createTheme,
  CssVarsThemeOptions,
  Shadows,
  Theme,
  ThemeOptions,
} from "@mui/material";
import { enUS, zhCN } from "@mui/x-data-grid/locales";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { MouseEvent, useCallback, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
const appWindow = getCurrentWebviewWindow();

/**
 * custom theme
 */
type CustomThemeOptions = Omit<ThemeOptions, "components"> &
  Pick<
    CssVarsThemeOptions,
    "defaultColorScheme" | "colorSchemes" | "components"
  > & {
    cssVariables?:
      | boolean
      | Pick<
          CssVarsThemeOptions,
          | "colorSchemeSelector"
          | "rootSelector"
          | "disableCssColorScheme"
          | "cssVarPrefix"
          | "shouldSkipGeneratingVar"
        >;
  };

export const useCustomTheme = () => {
  const { verge, patchVerge } = useVerge();
  const { theme_mode, light_theme_setting, dark_theme_setting, language } =
    verge ?? {};
  const mode = useThemeMode();
  const setMode = useSetThemeMode();
  const [themeSettings, setThemeSettings] = useThemeSettings();

  const themeSettingHasChanges = useCallback(
    (
      lightSettings: IVergeConfig["light_theme_setting"],
      darkSettings: IVergeConfig["dark_theme_setting"],
    ): boolean => {
      const originLightSettings = themeSettings.light!;
      const originDarkSettings = themeSettings.dark!;
      for (const key in lightSettings) {
        const lightKey = key as keyof IVergeConfig["light_theme_setting"];
        if (lightSettings[lightKey] !== originLightSettings[lightKey]) {
          return true;
        }
      }
      for (const key in darkSettings) {
        const darkKey = key as keyof IVergeConfig["dark_theme_setting"];
        if (darkSettings[darkKey] !== originDarkSettings[darkKey]) {
          return true;
        }
      }
      return false;
    },
    [themeSettings],
  );

  useEffect(() => {
    if (!light_theme_setting || !dark_theme_setting) return;
    if (themeSettingHasChanges(light_theme_setting, dark_theme_setting)) {
      setThemeSettings({
        light: light_theme_setting,
        dark: dark_theme_setting,
      });
    }
  }, [light_theme_setting, dark_theme_setting]);

  useEffect(() => {
    if (!theme_mode) return;
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
    const setting = themeSettings[mode]!;
    const dt = mode === "light" ? defaultTheme : defaultDarkTheme;
    const isDark = mode === "dark";

    const muiDataGridLocale = language === "zh" ? zhCN : enUS;
    const rootElement = document.getElementById("root");

    const defaultThemeObj: CustomThemeOptions = {
      cssVariables: true,
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
      // All `Portal`-related components need to have the the main app wrapper element as a container
      // so that the are in the subtree under the element used in the `important` option of the Tailwind's config.
      components: {
        MuiPopover: {
          defaultProps: {
            container: rootElement,
          },
          styleOverrides: {
            paper: {
              boxShadow:
                "0px 5px 5px -3px rgba(0,0,0,0.2),0px 8px 10px 1px rgba(0,0,0,0.14),0px 3px 14px 2px rgba(0,0,0,0.12)",
            },
          },
        },
        MuiPopper: {
          defaultProps: {
            container: rootElement,
          },
        },
        MuiDialog: {
          defaultProps: {
            container: rootElement,
          },
        },
        MuiModal: {
          defaultProps: {
            container: rootElement,
          },
        },
      },
    };

    const customThemeObj: CustomThemeOptions = {
      ...defaultThemeObj,
      palette: {
        ...defaultThemeObj.palette,
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
        fontFamily: setting.font_family
          ? `${setting.font_family}, ${dt.font_family}`
          : dt.font_family,
      },
    };

    let theme: Theme;
    try {
      theme = createTheme(customThemeObj, muiDataGridLocale);
    } catch {
      // fix #294
      theme = createTheme(defaultThemeObj, muiDataGridLocale);
    }

    // css
    const backgroundColor = isDark ? "#2e303d" : "#f0f0f0";
    const selectColor = isDark ? "#d5d5d5" : "#f5f5f5";
    const scrollColor = isDark ? "#54545480" : "#90939980";
    const dividerColor = isDark
      ? "rgba(255, 255, 255, 0.06)"
      : "rgba(0, 0, 0, 0.06)";

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
      style.innerHTML = setting?.css_injection || "";
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

    // init current theme
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    return theme;
  }, [mode, themeSettings, language]);

  const toggleTheme = async (
    event: MouseEvent,
    vergeThemeMode: "light" | "dark" | "system",
  ) => {
    let tmp: "light" | "dark" = "light";
    if (vergeThemeMode === "system") {
      const appTheme = await appWindow.theme();
      tmp = appTheme as "light" | "dark";
    } else {
      tmp = vergeThemeMode;
    }
    const nextThemeMode = tmp;
    if (mode === nextThemeMode) {
      patchVerge({ theme_mode: vergeThemeMode });
      return;
    }
    const isDark = nextThemeMode === "light";
    // @ts-ignore
    // prettier-ignore
    const isAppearanceTransition = document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // isAppearanceTransition return true in new webkit version on arch linux, but it not actually work. so we deside to enable it only on windows.
    if (!isAppearanceTransition || getSystem() !== "windows") {
      setMode(isDark ? "light" : "dark");
      if (isDark) {
        document.documentElement.classList.remove("dark");
      } else {
        document.documentElement.classList.add("dark");
      }
      patchVerge({ theme_mode: vergeThemeMode });
      return;
    }

    const x = event.clientX;
    const y = event.clientY;
    const endRadius = Math.hypot(
      Math.max(x, innerWidth - x),
      Math.max(y, innerHeight - y),
    );

    const transition = document.startViewTransition(() => {
      flushSync(() => {
        setMode(isDark ? "light" : "dark");
        if (isDark) {
          document.documentElement.classList.remove("dark");
        } else {
          document.documentElement.classList.add("dark");
        }
        patchVerge({ theme_mode: vergeThemeMode });
      });
    });
    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ];
      document.documentElement.animate(
        {
          clipPath: isDark ? [...clipPath].reverse() : clipPath,
        },
        {
          duration: 400,
          easing: "ease-out",
          pseudoElement: isDark
            ? "::view-transition-old(root)"
            : "::view-transition-new(root)",
        },
      );
    });
  };

  return { theme, toggleTheme };
};
