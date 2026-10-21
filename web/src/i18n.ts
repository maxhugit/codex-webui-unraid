/** i18next configuration with locale catalogs loaded only when requested. */
import i18n, { type BackendModule, type ReadCallback } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import {
  defaultLocale,
  defaultNamespace,
  loadLocaleNamespace,
  namespaces,
  supportedLocales,
} from './locales';

const catalogBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language: string, namespace: string, callback: ReadCallback) {
    void loadLocaleNamespace(language, namespace).then(
      (catalog) => callback(null, catalog),
      (error: unknown) =>
        callback(
          error instanceof Error ? error : new Error(String(error)),
          false,
        ),
    );
  },
};

export const i18nReady = i18n
  .use(LanguageDetector)
  .use(catalogBackend)
  .use(initReactI18next)
  .init({
    fallbackLng: defaultLocale,
    supportedLngs: supportedLocales,
    ns: namespaces,
    defaultNS: defaultNamespace,
    load: 'languageOnly',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
