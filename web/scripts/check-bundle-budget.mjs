import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDirectory = path.resolve(webRoot, '..', 'public', 'assets');

const budgets = {
  maximumJavaScriptAssetBytes: 1_350_000,
  totalJavaScriptBytes: 25_000_000,
  translationKeyAssetBytes: 90_000,
};

const entries = await readdir(assetsDirectory, { withFileTypes: true }).catch(
  () => null,
);

if (!entries) {
  console.error('Frontend assets are missing. Run the frontend build first.');
  process.exit(1);
}

const assets = await Promise.all(
  entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map(async (entry) => ({
      name: entry.name,
      size: (await stat(path.join(assetsDirectory, entry.name))).size,
    })),
);

assets.sort((left, right) => right.size - left.size);
const totalJavaScriptBytes = assets.reduce((total, asset) => total + asset.size, 0);
const largestAsset = assets[0];
const translationKeyAsset = assets.find((asset) =>
  asset.name.startsWith('translation-key-'),
);
const failures = [];

if (!largestAsset) {
  failures.push('No JavaScript assets were produced.');
} else if (largestAsset.size > budgets.maximumJavaScriptAssetBytes) {
  failures.push(
    `${largestAsset.name} is ${largestAsset.size} bytes; budget is ${budgets.maximumJavaScriptAssetBytes}.`,
  );
}

if (totalJavaScriptBytes > budgets.totalJavaScriptBytes) {
  failures.push(
    `JavaScript assets total ${totalJavaScriptBytes} bytes; budget is ${budgets.totalJavaScriptBytes}.`,
  );
}

if (
  translationKeyAsset &&
  translationKeyAsset.size > budgets.translationKeyAssetBytes
) {
  failures.push(
    `${translationKeyAsset.name} is ${translationKeyAsset.size} bytes; budget is ${budgets.translationKeyAssetBytes}.`,
  );
}

console.log('Largest JavaScript assets:');
for (const asset of assets.slice(0, 5)) {
  console.log(`- ${asset.name}: ${asset.size} bytes`);
}
console.log(`Total JavaScript: ${totalJavaScriptBytes} bytes`);

if (failures.length > 0) {
  console.error('\nBundle budget exceeded:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Frontend bundle budgets are respected.');
