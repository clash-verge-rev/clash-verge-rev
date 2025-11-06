import "i18next";

import type { TranslationResources } from "./generated/i18n-resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: TranslationResources;
    enableSelector: "optimize";
  }
}
