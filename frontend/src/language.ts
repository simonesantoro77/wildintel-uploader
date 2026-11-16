/** The languages the interface is offered in. Adding one is adding a line here
 *  (and its texts when the pages are translated). */
export interface Language {
  /** BCP 47 code, also the value of the page's `lang`. */
  code: string
  /** Its name in its own language. */
  name: string
}

export const LANGUAGES: Language[] = [{ code: 'en', name: 'English' }]

export const DEFAULT_LANGUAGE = 'en'

const STORAGE_KEY = 'wildintel.language'

/** The language chosen before, or the default when none or one that is no longer offered. */
export function storedLanguage(): string {
  try {
    const code = localStorage.getItem(STORAGE_KEY)
    if (code && LANGUAGES.some(l => l.code === code)) return code
  } catch { /* storage may be blocked */ }
  return DEFAULT_LANGUAGE
}

export function storeLanguage(code: string): void {
  try { localStorage.setItem(STORAGE_KEY, code) } catch { /* storage may be blocked */ }
}
