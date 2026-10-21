import { describe, expect, it } from 'vitest';
import en from './en/legacy.json';
import fr from './fr/legacy.json';
import { localeResources, namespaces } from './index';

const interpolationVariables = (value: string) =>
  [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1])
    .sort();

const englishPluralValues: Record<string, string> = {
  '{{count}} relation_one': '{{count}} relation',
  '{{count}} relation_other': '{{count}} relations',
  '{{count}} column_one': '{{count}} column',
  '{{count}} column_other': '{{count}} columns',
  '{{count}} row_one': '{{count}} row',
  '{{count}} row_other': '{{count}} rows',
};

describe('translation catalogs', () => {
  it('registers the same namespaces for every supported locale', () => {
    for (const resources of Object.values(localeResources)) {
      expect(Object.keys(resources).sort()).toEqual([...namespaces].sort());
    }
  });

  it('keeps the English and French legacy catalogs in sync', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it('uses explicit English source values during the legacy migration', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, key).toBe(englishPluralValues[key] ?? key);
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
