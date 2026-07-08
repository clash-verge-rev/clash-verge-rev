import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

export const supportedLanguages = [
  'en',
  'ru',
  'zh',
  'fa',
  'tt',
  'id',
  'ar',
  'ko',
  'tr',
  'de',
  'es',
  'jp',
  'zhtw',
]

export const FALLBACK_LANGUAGE = 'zh'
const LANGUAGE_STORAGE_KEY = 'verge-language'

const normalizeLanguage = (language?: string) =>
  language?.toLowerCase().replace(/_/g, '-')

export const resolveLanguage = (language?: string) => {
  const normalized = normalizeLanguage(language)
  if (!normalized) {
    return FALLBACK_LANGUAGE
  }

  if (normalized === 'zh-tw') return 'zhtw'
  if (normalized === 'zh-cn') return 'zh'

  if (supportedLanguages.includes(normalized)) {
    return normalized
  }

  const baseLanguage = normalized.split('-')[0]
  if (supportedLanguages.includes(baseLanguage)) {
    return baseLanguage
  }

  return FALLBACK_LANGUAGE
}

const getLanguageStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const cacheLanguage = (language: string) => {
  const storage = getLanguageStorage()
  if (!storage) return

  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, resolveLanguage(language))
  } catch (error) {
    console.warn('[i18n] Failed to cache language:', error)
  }
}

export const getCachedLanguage = () => {
  const storage = getLanguageStorage()
  if (!storage) return undefined

  try {
    const cached = storage.getItem(LANGUAGE_STORAGE_KEY)
    return cached ? resolveLanguage(cached) : undefined
  } catch (error) {
    console.warn('[i18n] Failed to read cached language:', error)
    return undefined
  }
}

type LocaleModule = {
  default: Record<string, unknown>
}

const STARTUP_LANGUAGE_SECTIONS = [
  'layout',
  'home',
  'shared',
  'settings',
  'profiles',
  'proxies',
  'tests',
] as const

const localeModules = import.meta.glob<LocaleModule>('@/locales/*/*.json')

const localeLoaders = Object.entries(localeModules).reduce<
  Record<string, Record<string, () => Promise<LocaleModule>>>
>((acc, [path, loader]) => {
  const match = path.match(/[/\\]locales[/\\]([^/\\]+)[/\\]([^/\\]+)\.json$/)
  if (match) {
    const [, language, section] = match
    acc[language] ??= {}
    acc[language][section] = loader
  }
  return acc
}, {})

export const languages: Record<string, any> = supportedLanguages.reduce(
  (acc, lang) => {
    acc[lang] = {}
    return acc
  },
  {} as Record<string, any>,
)

const loadLanguageSections = async (
  language: string,
  sections: readonly string[],
) => {
  try {
    const entries = await Promise.all(
      sections.map(async (section) => {
        const loader = localeLoaders[language]?.[section]
        if (!loader) {
          throw new Error(
            `Locale loader not found for language "${language}" section "${section}"`,
          )
        }

        const module = await loader()
        return [section, module.default] as const
      }),
    )

    return Object.fromEntries(entries)
  } catch (error) {
    if (language !== FALLBACK_LANGUAGE) {
      console.warn(
        `Failed to load language ${language}, fallback to ${FALLBACK_LANGUAGE}, ${error}`,
      )
      return loadLanguageSections(FALLBACK_LANGUAGE, sections)
    }
    throw error
  }
}

export const loadLanguage = async (language: string) =>
  loadLanguageSections(language, STARTUP_LANGUAGE_SECTIONS)

const getLoadedLanguageSections = (language: string) =>
  Object.keys(i18n.getResourceBundle(language, 'translation') ?? {})

i18n.use(initReactI18next).init({
  resources: {},
  lng: FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
})

export const ensureLanguageSections = async (
  sections: string | readonly string[],
  language: string = i18n.language || FALLBACK_LANGUAGE,
) => {
  const targetLanguage = resolveLanguage(language)
  const sectionList = Array.isArray(sections) ? sections : [sections]
  const loadedSections = new Set(getLoadedLanguageSections(targetLanguage))
  const missingSections = sectionList.filter(
    (section) => !loadedSections.has(section),
  )

  if (!missingSections.length) {
    return
  }

  const resources = await loadLanguageSections(targetLanguage, missingSections)
  i18n.addResourceBundle(targetLanguage, 'translation', resources, true, true)
}

export const changeLanguage = async (language: string) => {
  const targetLanguage = resolveLanguage(language)
  const loadedSections = getLoadedLanguageSections(
    i18n.language || FALLBACK_LANGUAGE,
  )

  await ensureLanguageSections(
    loadedSections.length ? loadedSections : STARTUP_LANGUAGE_SECTIONS,
    targetLanguage,
  )

  await i18n.changeLanguage(targetLanguage)
  cacheLanguage(targetLanguage)
}

export const initializeLanguage = async (
  initialLanguage: string = FALLBACK_LANGUAGE,
) => {
  await changeLanguage(initialLanguage)
}
