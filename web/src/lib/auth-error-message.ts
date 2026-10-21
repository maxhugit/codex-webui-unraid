import { translationKey } from '@/locales/translation-key';
import type { TFunction } from 'i18next';

const authenticationErrorKeys: Record<string, string> = {
  'Authentication request failed': 'errors.requestFailed',
  'Invalid authentication configuration': 'errors.invalidConfiguration',
  'Configure at least one active local account before enabling local authentication':
    'errors.localAccountRequired',
  'Disable local authentication before removing its last account':
    'errors.disableLocalBeforeLastRemoval',
  'Unknown person': 'errors.unknownPerson',
  'A local password cannot be configured for an SSO-linked account':
    'errors.ssoPasswordForbidden',
  'Username is already in use': 'errors.usernameInUse',
  'A password is required': 'errors.passwordRequired',
  'Invalid password': 'errors.invalidPassword',
  'Password must contain at least 12 characters': 'errors.passwordTooShort',
  'Invalid username': 'errors.invalidUsername',
  'Username must contain 3 to 64 lowercase letters, digits, dots, dashes or underscores':
    'errors.usernameFormat',
  'OIDC issuer, client ID and client secret are required':
    'errors.oidcRequiredFields',
  'OIDC redirect URI is required': 'errors.oidcRedirectRequired',
  'Invalid OIDC issuer': 'errors.oidcInvalidIssuer',
  'Invalid OIDC redirect URI': 'errors.oidcInvalidRedirect',
  'OIDC issuer must use HTTPS': 'errors.oidcIssuerHttps',
  'OIDC redirect URI must use HTTPS': 'errors.oidcRedirectHttps',
  'OIDC scopes must include openid': 'errors.oidcOpenidScope',
  'OIDC provider metadata is missing required endpoints': 'errors.oidcMetadata',
  'Unable to contact OIDC provider': 'errors.oidcUnavailable',
};

export function authenticationErrorMessage(
  error: unknown,
  t: TFunction<'authentication'>,
  fallbackKey: string,
): string {
  const message = error instanceof Error ? error.message : '';
  return t(translationKey(authenticationErrorKeys[message] ?? fallbackKey));
}
