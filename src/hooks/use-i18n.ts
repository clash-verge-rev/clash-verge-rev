import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { changeLanguage, supportedLanguages } from "@/services/i18n";
import { useVerge } from "./use-verge";

export const useI18n = () => {
  const { i18n, t } = useTranslation();
  const { patchVerge } = useVerge();
  const [isLoading, setIsLoading] = useState(false);

  const switchLanguage = useCallback(
    async (language: string) => {
      if (!supportedLanguages.includes(language)) {
        console.warn(`Unsupported language: ${language}`);
        return;
      }

      if (i18n.language === language) {
        return;
      }

      setIsLoading(true);
      try {
        await changeLanguage(language);

        if (patchVerge) {
          await patchVerge({ language });
        }
      } catch (error) {
        console.error("Failed to change language:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [i18n.language, patchVerge],
  );

  return {
    currentLanguage: i18n.language,
    supportedLanguages,
    switchLanguage,
    isLoading,
    t,
  };
};
