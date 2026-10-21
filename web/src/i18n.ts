/** i18next configuration. The legacy namespace keeps natural-language keys during migration. */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import {
  defaultLocale,
  defaultNamespace,
  localeResources,
  namespaces,
  supportedLocales,
} from './locales';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: localeResources,
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
