import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// 每个语言手动导入所有命名空间
import enTranslation from "@/locales/en/translation.json";
import enSettings from "@/locales/en/settings.json";
import enProxy from "@/locales/en/proxy.json";
import enBackup from "@/locales/en/backup.json";
import enSubscription from "@/locales/en/subscription.json";
import enRule from "@/locales/en/rule.json";
import enBasic from "@/locales/en/basic.json";
import enProfile from "@/locales/en/profile.json";
import enStatus from "@/locales/en/status.json";
import enUnlock from "@/locales/en/unlock.json";
import enGroup from "@/locales/en/group.json";
import enNetwork from "@/locales/en/network.json";
import enNotification from "@/locales/en/notification.json";
import enDialog from "@/locales/en/dialog.json";
import enCommon from "@/locales/en/common.json";

import zhTranslation from "@/locales/zh/translation.json";
import zhSettings from "@/locales/zh/settings.json";
import zhProxy from "@/locales/zh/proxy.json";
import zhBackup from "@/locales/zh/backup.json";
import zhSubscription from "@/locales/zh/subscription.json";
import zhRule from "@/locales/zh/rule.json";
import zhBasic from "@/locales/zh/basic.json";
import zhProfile from "@/locales/zh/profile.json";
import zhStatus from "@/locales/zh/status.json";
import zhUnlock from "@/locales/zh/unlock.json";
import zhGroup from "@/locales/zh/group.json";
import zhNetwork from "@/locales/zh/network.json";
import zhNotification from "@/locales/zh/notification.json";
import zhDialog from "@/locales/zh/dialog.json";
import zhCommon from "@/locales/zh/common.json";

import ruTranslation from "@/locales/ru/translation.json";
import ruSettings from "@/locales/ru/settings.json";
import ruProxy from "@/locales/ru/proxy.json";
import ruBackup from "@/locales/ru/backup.json";
import ruSubscription from "@/locales/ru/subscription.json";
import ruRule from "@/locales/ru/rule.json";
import ruBasic from "@/locales/ru/basic.json";
import ruProfile from "@/locales/ru/profile.json";
import ruStatus from "@/locales/ru/status.json";
import ruUnlock from "@/locales/ru/unlock.json";
import ruGroup from "@/locales/ru/group.json";
import ruNetwork from "@/locales/ru/network.json";
import ruNotification from "@/locales/ru/notification.json";
import ruDialog from "@/locales/ru/dialog.json";
import ruCommon from "@/locales/ru/common.json";

// 其他语言可按需添加

const resources = {
  en: {
    translation: enTranslation,
    settings: enSettings,
    proxy: enProxy,
    backup: enBackup,
    subscription: enSubscription,
    rule: enRule,
    basic: enBasic,
    profile: enProfile,
    status: enStatus,
    unlock: enUnlock,
    group: enGroup,
    network: enNetwork,
    notification: enNotification,
    dialog: enDialog,
    common: enCommon,
  },
  zh: {
    translation: zhTranslation,
    settings: zhSettings,
    proxy: zhProxy,
    backup: zhBackup,
    subscription: zhSubscription,
    rule: zhRule,
    basic: zhBasic,
    profile: zhProfile,
    status: zhStatus,
    unlock: zhUnlock,
    group: zhGroup,
    network: zhNetwork,
    notification: zhNotification,
    dialog: zhDialog,
    common: zhCommon,
  },
  ru: {
    translation: ruTranslation,
    settings: ruSettings,
    proxy: ruProxy,
    backup: ruBackup,
    subscription: ruSubscription,
    rule: ruRule,
    basic: ruBasic,
    profile: ruProfile,
    status: ruStatus,
    unlock: ruUnlock,
    group: ruGroup,
    network: ruNetwork,
    notification: ruNotification,
    dialog: ruDialog,
    common: ruCommon,
  },
  // 其他语言照此添加
};

i18n.use(initReactI18next).init({
  resources,
  lng: "zh", // 默认语言
  fallbackLng: "en", // 回退语言为英文
  ns: [
    "translation",
    "settings",
    "proxy",
    "backup",
    "subscription",
    "rule",
    "basic",
    "profile",
    "status",
    "unlock",
    "group",
    "network",
    "notification",
    "dialog",
    "common",
  ], // 所有命名空间
  defaultNS: "translation", // 默认使用的命名空间
  keySeparator: false, // 允许 t('proxy:Current Node') 形式自动分割命名空间
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
