import enAuthentication from './en/authentication.json';
import enLegacy from './en/legacy.json';
import frAuthentication from './fr/authentication.json';
import frLegacy from './fr/legacy.json';

/**
 * `legacy` is the compatibility namespace for the existing natural-language
 * keys. New feature catalogs can be added beside it and migrated independently.
 */
export const localeResources = {
  en: { authentication: enAuthentication, legacy: enLegacy },
  fr: { authentication: frAuthentication, legacy: frLegacy },
} as const;

export const defaultLocale = 'en' as const;
export const supportedLocales = ['en', 'fr'] as const;
export const namespaces = ['authentication', 'legacy'] as const;
export const defaultNamespace = 'legacy' as const;

export type SupportedLocale = (typeof supportedLocales)[number];
