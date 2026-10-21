import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const localesRoot = path.join(webRoot, 'src', 'locales');
const manifestPath = path.join(localesRoot, 'manifest.json');
const [codeInput, nativeLabelInput] = process.argv.slice(2);
const code = codeInput?.trim().toLowerCase();
const nativeLabel = nativeLabelInput?.trim();

if (!code || !nativeLabel) {
  console.error('Usage: pnpm i18n:add-locale -- <code> "<native label>"');
  process.exit(1);
}
if (!/^[a-z]{2,3}$/.test(code)) {
  console.error('Locale code must contain two or three lowercase letters.');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.locales.some((locale) => locale.code === code)) {
  console.error(`Locale ${code} already exists.`);
  process.exit(1);
}

const targetDirectory = path.join(localesRoot, code);
await mkdir(targetDirectory);
for (const namespace of manifest.namespaces) {
  await copyFile(
    path.join(localesRoot, manifest.defaultLocale, `${namespace}.json`),
    path.join(targetDirectory, `${namespace}.json`),
  );
}
manifest.locales.push({ code, nativeLabel });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Created ${code} with ${manifest.namespaces.length} catalogs.`);
console.log('Translate the copied English values, then run pnpm check:i18n.');
