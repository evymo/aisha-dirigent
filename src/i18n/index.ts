import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

type I18nBackend = {
  type: 'backend';
  read: (
    language: string,
    namespace: string,
    callback: (error: unknown, resources: Record<string, unknown> | false) => void
  ) => void;
};

const localeImportMap: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('./locales/en.json'),
  cs: () => import('./locales/cs.json'),
  de: () => import('./locales/de.json'),
  fr: () => import('./locales/fr.json'),
  ru: () => import('./locales/ru.json'),
  th: () => import('./locales/th.json'),
};

const dynamicJsonBackend: I18nBackend = {
  type: 'backend',
  read: (language, _namespace, callback) => {
    const loader = localeImportMap[language] ?? localeImportMap.en;
    loader()
      .then((mod) => callback(null, mod.default))
      .catch((error) => callback(error, false));
  },
};

let initPromise: Promise<typeof i18n> | null = null;

export function initI18n(): Promise<typeof i18n> {
  if (initPromise) return initPromise;

  initPromise = i18n
    .use(dynamicJsonBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      // We ship locales incrementally. Language fallback keeps the UI usable in partially translated locales.
      // Missing keys (even after fallback) should remain identifiable by falling back to the translation key.
      fallbackLng: 'en',
      // NOTE: `supportedLngs` is deliberately NOT set.
      //
      // It used to list the chrome locales (`localeImportMap` keys). That made
      // i18next reject every CONTENT locale a fork adds via `supported_languages`
      // — and it does so by truncating the resolve hierarchy, so even a present
      // translation becomes unreachable, e.g. for an instance's es/it:
      //
      //   supportedLngs: [...chrome]  -> changeLanguage('es'): language=es, hierarchy=[en]  (es row ignored)
      //                               -> changeLanguage('it'): language=en  (selection snaps back)
      //   no supportedLngs            -> changeLanguage('es'): language=es, hierarchy=[es,en]
      //
      // Unknown languages stay safe without it: `dynamicJsonBackend` serves
      // en.json for anything absent from `localeImportMap`, and `fallbackLng`
      // resolves missing keys per key — which is the documented chain
      // (locale -> EN -> key name), not a whole-language collapse. DB content
      // falls back the same way, server-side, via
      // `get_translation_value_with_fallback`.
      //
      // The set of languages on offer is enforced where it is actually known —
      // `supported_languages` (DB), which is what LanguageSwitcher renders.
      ns: ['translation'],
      defaultNS: 'translation',
      interpolation: {
        escapeValue: false,
      },
      detection: {
        order: ['querystring', 'localStorage', 'navigator', 'htmlTag'],
        lookupQuerystring: 'lang',
        caches: ['localStorage'],
      },
    })
    .then(() => i18n);

  return initPromise;
}

// Initialize eagerly (but with dynamically loaded resources) to keep app behavior consistent.
void initI18n();

export default i18n;
