import enLegacy from './en/legacy.json';
import frLegacy from './fr/legacy.json';

/**
 * `legacy` is the compatibility namespace for the existing natural-language
 * keys. New feature catalogs can be added beside it and migrated independently.
 */
export const localeResources = {
  en: { legacy: enLegacy },
  fr: { legacy: frLegacy },
} as const;

export const defaultLocale = 'en' as const;
export const supportedLocales = ['en', 'fr'] as const;
export const namespaces = ['legacy'] as const;
export const defaultNamespace = 'legacy' as const;

export type SupportedLocale = (typeof supportedLocales)[number];
