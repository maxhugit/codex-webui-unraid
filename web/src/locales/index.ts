import type { ResourceKey } from 'i18next';
import manifest from './manifest.json';

type CatalogModule = { default: ResourceKey };
type CatalogLoader = () => Promise<CatalogModule>;

const catalogModules = import.meta.glob<CatalogModule>('./*/*.json');

export const localeDefinitions = manifest.locales;
export const supportedLocales = manifest.locales.map(({ code }) => code);
export const namespaces = manifest.namespaces;
export const defaultLocale = manifest.defaultLocale;
export const defaultNamespace = manifest.defaultNamespace;

export type SupportedLocale = string;

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return (
    typeof value === 'string' && supportedLocales.includes(value.toLowerCase())
  );
}

export async function loadLocaleNamespace(
  locale: string,
  namespace: string,
): Promise<ResourceKey> {
  if (!isSupportedLocale(locale) || !namespaces.includes(namespace))
    throw new Error(`Unsupported translation catalog: ${locale}/${namespace}`);
  const loader = catalogModules[
    `./${locale.toLowerCase()}/${namespace}.json`
  ] as CatalogLoader | undefined;
  if (!loader)
    throw new Error(`Missing translation catalog: ${locale}/${namespace}`);
  return (await loader()).default;
}

export async function loadLocaleResources(locale: string) {
  const entries = await Promise.all(
    namespaces.map(async (namespace) => [
      namespace,
      await loadLocaleNamespace(locale, namespace),
    ]),
  );
  return Object.fromEntries(entries);
}
