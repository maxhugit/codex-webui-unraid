import { describe, expect, it } from 'vitest';
import en from './en/common.json';
import fr from './fr/common.json';
import {
  loadLocaleNamespace,
  loadLocaleResources,
  namespaces,
  supportedLocales,
} from './index';

const interpolationVariables = (value: string) =>
  [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1])
    .sort();

const flatten = (
  value: unknown,
  prefix = '',
  output: Record<string, string> = {},
) => {
  if (typeof value === 'string') {
    output[prefix] = value;
    return output;
  }
  for (const [key, child] of Object.entries(value as object)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
};

describe('translation catalogs', () => {
  it('loads the same namespaces for every supported locale', async () => {
    for (const locale of supportedLocales) {
      const resources = await loadLocaleResources(locale);
      expect(Object.keys(resources).sort()).toEqual([...namespaces].sort());
    }
  });

  it('keeps keys and interpolation variables aligned in every namespace', async () => {
    for (const namespace of namespaces) {
      const source = flatten(await loadLocaleNamespace('en', namespace));
      for (const locale of supportedLocales.filter((item) => item !== 'en')) {
        const target = flatten(await loadLocaleNamespace(locale, namespace));
        expect(Object.keys(target).sort(), `${locale}/${namespace}`).toEqual(
          Object.keys(source).sort(),
        );
        for (const key of Object.keys(source)) {
          expect(
            interpolationVariables(target[key]),
            `${locale}/${namespace}:${key}`,
          ).toEqual(interpolationVariables(source[key]));
        }
      }
    }
  });

  it('rejects catalogs that are not declared in the manifest', async () => {
    await expect(loadLocaleNamespace('es', 'common')).rejects.toThrow(
      'Unsupported translation catalog',
    );
  });

  it('uses semantic common keys instead of English source copy', () => {
    for (const key of Object.keys(en)) {
      expect(key, key).toMatch(
        /^[a-z][A-Za-z0-9]*(?:_(?:zero|one|two|few|many|other))?$/,
      );
    }
  });

  it('preserves interpolation variables in every French translation', () => {
    for (const [key, value] of Object.entries(fr)) {
      expect(interpolationVariables(value), key).toEqual(
        interpolationVariables(en[key as keyof typeof en]),
      );
    }
  });
});
