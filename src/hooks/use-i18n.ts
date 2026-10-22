import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import {
  changeLanguage,
  resolveLanguage,
  supportedLanguages,
} from '@/services/i18n'

export const useI18n = () => {
  const { i18n, t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)

  const switchLanguage = useCallback(
    async (language: string) => {
      const targetLanguage = resolveLanguage(language)

      if (!supportedLanguages.includes(targetLanguage)) {
        console.warn(`Unsupported language: ${language}`)
        return
      }

      if (i18n.language === targetLanguage) {
        return
      }

      setIsLoading(true)
      try {
        await changeLanguage(targetLanguage)
      } catch (error) {
        console.error('Failed to change language:', error)
      } finally {
        setIsLoading(false)
      }
    },
    [i18n.language],
  )

  return {
    currentLanguage: i18n.language,
    supportedLanguages,
    switchLanguage,
    isLoading,
    t,
  }
}
