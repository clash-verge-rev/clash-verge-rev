import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import zh from "@/locales/zh.json";

export const languages = { en, zh };

const resources = Object.fromEntries(
  Object.entries(languages).map(([key, value]) => [
    key,
    { translation: value },
  ]),
);

i18n.use(initReactI18next).init({
  resources,
  lng: "zh",
  fallbackLng: "zh",
  interpolation: {
    escapeValue: false,
  },
});
