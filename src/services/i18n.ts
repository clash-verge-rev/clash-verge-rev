import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const supportedLanguages = [
  "en",
  "ru",
  "zh",
  "fa",
  "tt",
  "id",
  "ar",
  "ko",
  "tr",
  "de",
  "es",
  "jp",
  "zhtw",
];

export const FALLBACK_LANGUAGE = "zh";
const LANGUAGE_STORAGE_KEY = "verge-language";

const normalizeLanguage = (language?: string) =>
  language?.toLowerCase().replace(/_/g, "-");

export const resolveLanguage = (language?: string) => {
  const normalized = normalizeLanguage(language);
  if (!normalized) {
    return FALLBACK_LANGUAGE;
  }

  if (normalized === "zh-tw") return "zhtw";
  if (normalized === "zh-cn") return "zh";

  if (supportedLanguages.includes(normalized)) {
    return normalized;
  }

  const baseLanguage = normalized.split("-")[0];
  if (supportedLanguages.includes(baseLanguage)) {
    return baseLanguage;
  }

  return FALLBACK_LANGUAGE;
};

const getLanguageStorage = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const cacheLanguage = (language: string) => {
  const storage = getLanguageStorage();
  if (!storage) return;

  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, resolveLanguage(language));
  } catch (error) {
    console.warn("[i18n] Failed to cache language:", error);
  }
};

export const getCachedLanguage = () => {
  const storage = getLanguageStorage();
  if (!storage) return undefined;

  try {
    const cached = storage.getItem(LANGUAGE_STORAGE_KEY);
    return cached ? resolveLanguage(cached) : undefined;
  } catch (error) {
    console.warn("[i18n] Failed to read cached language:", error);
    return undefined;
  }
};

type LocaleModule = {
  default: Record<string, unknown>;
};

const localeModules = import.meta.glob<LocaleModule>("@/locales/*/index.ts");

const localeLoaders = Object.entries(localeModules).reduce<
  Record<string, () => Promise<LocaleModule>>
>((acc, [path, loader]) => {
  const match = path.match(/[/\\]locales[/\\]([^/\\]+)[/\\]index\.ts$/);
  if (match) {
    acc[match[1]] = loader;
  }
  return acc;
}, {});

export const languages: Record<string, any> = supportedLanguages.reduce(
  (acc, lang) => {
    acc[lang] = {};
    return acc;
  },
  {} as Record<string, any>,
);

export const loadLanguage = async (language: string) => {
  try {
    const loader = localeLoaders[language];
    if (!loader) {
      throw new Error(`Locale loader not found for language "${language}"`);
    }
    const module = await loader();
    return module.default;
  } catch (error) {
    if (language !== FALLBACK_LANGUAGE) {
      console.warn(
        `Failed to load language ${language}, fallback to ${FALLBACK_LANGUAGE}, ${error}`,
      );
      const fallbackLoader = localeLoaders[FALLBACK_LANGUAGE];
      if (!fallbackLoader) {
        throw new Error(
          `Fallback language "${FALLBACK_LANGUAGE}" resources are missing.`,
        );
      }
      const fallback = await fallbackLoader();
      return fallback.default;
    }
    throw error;
  }
};

i18n.use(initReactI18next).init({
  resources: {},
  lng: FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
});

export const changeLanguage = async (language: string) => {
  const targetLanguage = resolveLanguage(language);

  if (!i18n.hasResourceBundle(targetLanguage, "translation")) {
    const resources = await loadLanguage(targetLanguage);
    i18n.addResourceBundle(targetLanguage, "translation", resources);
  }

  await i18n.changeLanguage(targetLanguage);
  cacheLanguage(targetLanguage);
};

export const initializeLanguage = async (
  initialLanguage: string = FALLBACK_LANGUAGE,
) => {
  await changeLanguage(initialLanguage);
};
