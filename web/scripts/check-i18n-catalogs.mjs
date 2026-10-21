import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const localesRoot = path.join(webRoot, 'src', 'locales');
const manifest = JSON.parse(
  await readFile(path.join(localesRoot, 'manifest.json'), 'utf8'),
);
const sourceLocale = manifest.defaultLocale;
const declaredLocales = manifest.locales.map(({ code }) => code).sort();
const declaredNamespaces = [...manifest.namespaces].sort();

const localeNames = (await readdir(localesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const failures = [];
const semanticSegment = /^[a-z][A-Za-z0-9]*$/;
const isSemanticKey = (key) =>
  key.split('.').every((part) => semanticSegment.test(part));
if (!localeNames.includes(sourceLocale))
  failures.push(`Missing source locale: ${sourceLocale}`);
if (JSON.stringify(localeNames) !== JSON.stringify(declaredLocales))
  failures.push(
    `Locale directories differ from manifest (expected ${declaredLocales.join(', ')}, found ${localeNames.join(', ')})`,
  );
if (!declaredNamespaces.includes(manifest.defaultNamespace))
  failures.push(
    `Default namespace ${manifest.defaultNamespace} is not declared`,
  );
if (new Set(declaredLocales).size !== declaredLocales.length)
  failures.push('Manifest contains duplicate locale codes');
for (const locale of manifest.locales) {
  if (!/^[a-z]{2,3}$/.test(locale.code))
    failures.push(`Invalid locale code in manifest: ${locale.code}`);
  if (typeof locale.nativeLabel !== 'string' || !locale.nativeLabel.trim())
    failures.push(`Locale ${locale.code} has no native label`);
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
if (JSON.stringify(sourceNamespaces) !== JSON.stringify(declaredNamespaces))
  failures.push(
    `Source namespaces differ from manifest (expected ${declaredNamespaces.join(', ')}, found ${sourceNamespaces.join(', ')})`,
  );

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

    for (const key of sourceKeys) {
      const segments = key.split('.');
      const leaf = segments.pop();
      const semanticLeaf = leaf?.replace(
        /_(?:zero|one|two|few|many|other)$/,
        '',
      );
      if (
        !segments.every((part) => semanticSegment.test(part)) ||
        !semanticLeaf ||
        !semanticSegment.test(semanticLeaf)
      ) {
        failures.push(
          `${sourceLocale}/${namespace}:${key}: semantic keys must use lower camel case segments`,
        );
      }
    }
  }
}

const sourceKeyMap = JSON.parse(
  await readFile(path.join(localesRoot, 'source-key-map.json'), 'utf8'),
);
const commonKeys = await readCatalog(sourceLocale, 'common');
const declaredKeys = new Set();
for (const namespace of sourceNamespaces) {
  for (const key of (await readCatalog(sourceLocale, namespace)).keys()) {
    declaredKeys.add(key);
  }
}
for (const [source, key] of Object.entries(sourceKeyMap)) {
  if (!source.trim())
    failures.push('Runtime source-key map contains an empty source');
  if (!isSemanticKey(key.replace(/_(?:zero|one|two|few|many|other)$/, ''))) {
    failures.push(`Runtime source-key map has a non-semantic target: ${key}`);
  }
  if (!commonKeys.has(key)) {
    failures.push(
      `Runtime source-key map targets a missing common key: ${key}`,
    );
  }
}

const sourceFiles = [];
const collectSourceFiles = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectSourceFiles(fullPath);
    else if (
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      sourceFiles.push(fullPath);
    }
  }
};
await collectSourceFiles(path.join(webRoot, 'src'));

const translationCall = (node) =>
  ts.isCallExpression(node) &&
  node.arguments.length > 0 &&
  ((ts.isIdentifier(node.expression) && node.expression.text === 't') ||
    (ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 't'));

for (const filename of sourceFiles) {
  const source = await readFile(filename, 'utf8');
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node) => {
    if (translationCall(node)) {
      const argument = node.arguments[0];
      const wrapped =
        ts.isCallExpression(argument) &&
        ts.isIdentifier(argument.expression) &&
        argument.expression.text === 'translationKey';
      let hasNonSemanticLiteral = false;
      let hasLiteral = false;
      const inspect = (child) => {
        if (ts.isStringLiteralLike(child)) {
          hasLiteral = true;
          if (!isSemanticKey(child.text)) hasNonSemanticLiteral = true;
          else if (
            !declaredKeys.has(child.text) &&
            !declaredKeys.has(`${child.text}_one`) &&
            !declaredKeys.has(`${child.text}_other`)
          ) {
            const line = sourceFile.getLineAndCharacterOfPosition(
              child.getStart(sourceFile),
            ).line + 1;
            failures.push(
              `${path.relative(webRoot, filename)}:${line}: missing source translation key: ${child.text}`,
            );
          }
          return;
        }
        if (ts.isParenthesizedExpression(child)) inspect(child.expression);
        else if (ts.isConditionalExpression(child)) {
          inspect(child.whenTrue);
          inspect(child.whenFalse);
        } else if (
          ts.isBinaryExpression(child) &&
          (child.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
            child.operatorToken.kind === ts.SyntaxKind.BarBarToken)
        ) {
          inspect(child.left);
          inspect(child.right);
        }
      };
      if (!wrapped) inspect(argument);
      if (!wrapped && (!hasLiteral || hasNonSemanticLiteral)) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(
            argument.getStart(sourceFile),
          ).line + 1;
        failures.push(
          `${path.relative(webRoot, filename)}:${line}: translations must receive a semantic key or use translationKey for runtime source text`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
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
