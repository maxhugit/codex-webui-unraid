import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const localesRoot = path.join(webRoot, 'src', 'locales');
const sourceLocale = 'en';

const localeNames = (await readdir(localesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (!localeNames.includes(sourceLocale)) {
  throw new Error(`Missing source locale: ${sourceLocale}`);
}

const namespaceNames = async (locale) =>
  (await readdir(path.join(localesRoot, locale), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .sort();

const flatten = (value, prefix = '', output = new Map()) => {
  if (typeof value === 'string') {
    if (!prefix) throw new Error('Catalog root must be an object');
    output.set(prefix, value);
    return output;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      `Translation ${prefix || '<root>'} must be a string or object`,
    );
  }
  for (const [key, child] of Object.entries(value)) {
    if (!key)
      throw new Error(`Empty translation key below ${prefix || '<root>'}`);
    flatten(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
};

const variables = (value) =>
  [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1])
    .sort();

const readCatalog = async (locale, namespace) => {
  const catalogPath = path.join(localesRoot, locale, `${namespace}.json`);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(catalogPath, 'utf8'));
  } catch (error) {
    throw new Error(`${locale}/${namespace}.json is invalid: ${error.message}`);
  }
  return flatten(parsed);
};

const sourceNamespaces = await namespaceNames(sourceLocale);
const failures = [];

for (const locale of localeNames) {
  const actualNamespaces = await namespaceNames(locale);
  if (JSON.stringify(actualNamespaces) !== JSON.stringify(sourceNamespaces)) {
    failures.push(
      `${locale}: namespaces differ (expected ${sourceNamespaces.join(', ')}, found ${actualNamespaces.join(', ')})`,
    );
    continue;
  }

  for (const namespace of sourceNamespaces) {
    const source = await readCatalog(sourceLocale, namespace);
    const target = await readCatalog(locale, namespace);
    const sourceKeys = [...source.keys()].sort();
    const targetKeys = [...target.keys()].sort();
    const missing = sourceKeys.filter((key) => !target.has(key));
    const extra = targetKeys.filter((key) => !source.has(key));
    if (missing.length)
      failures.push(
        `${locale}/${namespace}: missing keys: ${missing.join(', ')}`,
      );
    if (extra.length)
      failures.push(`${locale}/${namespace}: extra keys: ${extra.join(', ')}`);

    for (const key of sourceKeys.filter((candidate) => target.has(candidate))) {
      const sourceVariables = variables(source.get(key));
      const targetVariables = variables(target.get(key));
      if (JSON.stringify(sourceVariables) !== JSON.stringify(targetVariables)) {
        failures.push(
          `${locale}/${namespace}:${key}: interpolation variables differ`,
        );
      }
    }

    if (namespace !== 'legacy') {
      for (const key of sourceKeys) {
        if (!key.split('.').every((part) => /^[a-z][A-Za-z0-9]*$/.test(part))) {
          failures.push(
            `${sourceLocale}/${namespace}:${key}: semantic keys must use lower camel case segments`,
          );
        }
      }
    }
  }
}

const migratedAuthenticationFiles = [
  'src/components/login.tsx',
  'src/components/settings/authentication-settings.tsx',
  'src/routes/authenticated-layout.tsx',
  'src/routes/login-route.tsx',
];
for (const relativePath of migratedAuthenticationFiles) {
  const source = await readFile(path.join(webRoot, relativePath), 'utf8');
  if (!source.includes("useTranslation('authentication')")) {
    failures.push(`${relativePath}: authentication namespace is not selected`);
  }
  if (/\bt\(\s*(?:error\.)?message\b/.test(source)) {
    failures.push(
      `${relativePath}: raw error messages must not be translation keys`,
    );
  }
}

if (failures.length) {
  console.error('Translation catalog validation failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${localeNames.length} locales and ${sourceNamespaces.length} namespaces.`,
  );
}
