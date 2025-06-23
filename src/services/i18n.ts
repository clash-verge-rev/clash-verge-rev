import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// 每个语言手动导入所有命名空间
import enTranslation from "@/locales/en/translation.json";
import enSettings from "@/locales/en/settings.json";

import zhTranslation from "@/locales/zh/translation.json";
import zhSettings from "@/locales/zh/settings.json";

import ruTranslation from "@/locales/ru/translation.json";
import ruSettings from "@/locales/ru/settings.json";

// 其他语言可按需添加

export const languages = {
  en: {
    translation: enTranslation,
    settings: enSettings,
  },
  zh: {
    translation: zhTranslation,
    settings: zhSettings,
  },
  ru: {
    translation: ruTranslation,
    settings: ruSettings,
  },
  // 其他语言照此添加
};

const resources = languages;

i18n.use(initReactI18next).init({
  resources,
  lng: "zh", // 默认语言
  fallbackLng: "en", // 回退语言为英文
  ns: ["translation", "settings"], // 所有命名空间
  defaultNS: "translation", // 默认使用的命名空间
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
