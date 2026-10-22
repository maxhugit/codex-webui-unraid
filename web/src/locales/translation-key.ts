/**
 * Resolve user-visible strings received from APIs or metadata to a stable key.
 *
 * Components should normally pass semantic keys directly to `t`. This bridge is
 * reserved for runtime values whose source text is controlled outside React,
 * such as Codex release notes and server-provided setting descriptions.
 */
import sourceCatalog from './en/common.json';

const semanticKey = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/;
const pluralSuffix = /_(?:zero|one|two|few|many|other)$/;

// The English catalog is already loaded as the i18next fallback. Derive the
// reverse lookup from that same source instead of shipping a second copy of
// every English value solely for legacy text compatibility.
const sourceKeys = new Map<string, string>();
for (const [key, source] of Object.entries(sourceCatalog)) {
  const baseKey = key.replace(pluralSuffix, '');
  if (!sourceKeys.has(source) || key === baseKey) sourceKeys.set(source, baseKey);
}

export function translationKey(value: string): string {
  if (semanticKey.test(value)) return value;
  return sourceKeys.get(value) ?? value;
}
