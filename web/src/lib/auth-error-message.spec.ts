import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { authenticationErrorMessage } from './auth-error-message';

const translation = () => {
  const fn = vi.fn((key: string) => `translated:${key}`);
  return fn as unknown as TFunction<'authentication'>;
};

describe('authenticationErrorMessage', () => {
  it('maps a known server message to a stable semantic key', () => {
    const t = translation();
    expect(
      authenticationErrorMessage(
        new Error('OIDC scopes must include openid'),
        t,
        'settings.saveError',
      ),
    ).toBe('translated:errors.oidcOpenidScope');
  });

  it('uses the localized fallback without exposing an unknown server error', () => {
    const t = translation();
    expect(
      authenticationErrorMessage(
        new Error('internal implementation detail'),
        t,
        'settings.loadError',
      ),
    ).toBe('translated:settings.loadError');
  });
});
