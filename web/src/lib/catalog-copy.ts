import { translationKey } from '@/locales/translation-key';
/**
 * Localization for English text that originates in an upstream service.
 *
 * Upstream APIs such as the app-server catalog and the official Codex release
 * feed return English source copy. The source map resolves that copy to a
 * stable semantic key; unknown upstream text remains unchanged.
 */
import i18n from '@/i18n';

/**
 * Returns the translation for a catalog string, or the string unchanged.
 *
 * Deliberately not a bare `t(value)`: i18next resolves `$t(...)` nesting even
 * for a missing key, so passing arbitrary upstream prose through `t()` can
 * silently rewrite it. Checking for an actual entry first means untranslated
 * copy is reproduced verbatim.
 *
 * @param value - English copy exactly as the catalog supplied it.
 * @returns The localized string when one exists, otherwise `value` untouched.
 */
export function localizedSourceCopy(value: string): string {
  const key = translationKey(value);
  return key !== value && i18n.exists(key)
    ? i18n.t(translationKey(value))
    : value;
}

/** Backward-compatible, domain-specific name used by the model catalog UI. */
export const catalogCopy = localizedSourceCopy;
