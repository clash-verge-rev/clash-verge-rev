import { getVergeConfig } from "./cmds";
import {
  cacheLanguage,
  getCachedLanguage,
  initializeLanguage,
  resolveLanguage,
} from "./i18n";

let vergeConfigCache: IVergeConfig | null | undefined;

const detectSystemTheme = (): "light" | "dark" => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const getThemeModeFromWindow = (): IVergeConfig["theme_mode"] | undefined => {
  if (typeof window === "undefined") return undefined;
  const mode = (
    window as typeof window & {
      __VERGE_INITIAL_THEME_MODE?: unknown;
    }
  ).__VERGE_INITIAL_THEME_MODE;
  if (mode === "light" || mode === "dark" || mode === "system") {
    return mode;
  }
  return undefined;
};

export const resolveThemeMode = (
  vergeConfig?: IVergeConfig | null,
): "light" | "dark" => {
  const initialMode = vergeConfig?.theme_mode ?? getThemeModeFromWindow();
  if (initialMode === "dark" || initialMode === "light") {
    return initialMode;
  }
  return detectSystemTheme();
};

export const setPreloadConfig = (config: IVergeConfig | null) => {
  vergeConfigCache = config;
};

export const getPreloadConfig = () => vergeConfigCache;

export const preloadConfig = async () => {
  try {
    const config = await getVergeConfig();
    setPreloadConfig(config);
    return config;
  } catch (error) {
    console.warn("[preload.ts] Failed to read Verge config:", error);
    setPreloadConfig(null);
    return null;
  }
};

export const preloadLanguage = async (
  vergeConfig?: IVergeConfig | null,
  loadConfig: () => Promise<IVergeConfig | null> = preloadConfig,
) => {
  const cachedLanguage = getCachedLanguage();
  if (cachedLanguage) {
    return cachedLanguage;
  }

  let resolvedConfig = vergeConfig;

  if (resolvedConfig === undefined) {
    try {
      resolvedConfig = await loadConfig();
    } catch (error) {
      console.warn(
        "[preload.ts] Failed to read language from Verge config:",
        error,
      );
      resolvedConfig = null;
    }
  }

  const languageFromConfig = resolvedConfig?.language;
  if (languageFromConfig) {
    const resolved = resolveLanguage(languageFromConfig);
    cacheLanguage(resolved);
    return resolved;
  }

  const browserLanguage = resolveLanguage(
    typeof navigator !== "undefined" ? navigator.language : undefined,
  );
  cacheLanguage(browserLanguage);
  return browserLanguage;
};

export const preloadAppData = async () => {
  const configPromise = preloadConfig();
  const initialLanguage = await preloadLanguage(undefined, () => configPromise);
  const [config] = await Promise.all([
    configPromise,
    initializeLanguage(initialLanguage),
  ]);
  const initialThemeMode = resolveThemeMode(config);
  return { initialThemeMode };
};
