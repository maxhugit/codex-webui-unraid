/** i18next configuration. English natural-language keys are the only UI locale. */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

void i18n
  .use(initReactI18next)
  .init({
    lng: 'en',
    resources: {},
    fallbackLng: 'en',
    supportedLngs: ['en'],
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
