import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import ru from "@/locales/ru.json";
import zh from "@/locales/zh.json";
import fa from "@/locales/fa.json";

const resources = {
  en: { translation: en },
  ru: { translation: ru },
  zh: { translation: zh },
  fa: { translation: fa },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});
