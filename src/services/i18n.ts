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

const FALLBACK_LANGUAGE = "zh";

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
  lng: "zh",
  fallbackLng: "zh",
  interpolation: {
    escapeValue: false,
  },
});

export const changeLanguage = async (language: string) => {
  if (!i18n.hasResourceBundle(language, "translation")) {
    const resources = await loadLanguage(language);
    i18n.addResourceBundle(language, "translation", resources);
  }

  await i18n.changeLanguage(language);
};

export const initializeLanguage = async (initialLanguage: string = "zh") => {
  await changeLanguage(initialLanguage);
};
