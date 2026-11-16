import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'

/** The languages the interface is offered in: adding one is adding its file in
 *  `locales/` and a line here and in `resources`. */
export interface Language {
  /** BCP 47 code, also the value of the page's `lang`. */
  code: string
  /** Its name in its own language. */
  name: string
}

export const LANGUAGES: Language[] = [{ code: 'en', name: 'English' }]

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    fallbackLng: 'en',
    supportedLngs: LANGUAGES.map(l => l.code),
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'wildintel.language',
      caches: ['localStorage'],
    },
  })

export default i18n
