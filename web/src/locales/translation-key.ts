/**
 * Resolve user-visible strings received from APIs or metadata to a stable key.
 *
 * Components should normally pass semantic keys directly to `t`. This bridge is
 * reserved for runtime values whose source text is controlled outside React,
 * such as Codex release notes and server-provided setting descriptions.
 */
import sourceKeys from './source-key-map.json';

const semanticKey = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/;

export function translationKey(value: string): string {
  if (semanticKey.test(value)) return value;
  return sourceKeys[value as keyof typeof sourceKeys] ?? value;
}
