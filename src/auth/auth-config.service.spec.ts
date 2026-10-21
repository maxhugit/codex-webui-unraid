import { ConfigService } from '@nestjs/config';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthConfigService } from './auth-config.service';

describe('AuthConfigService', () => {
  let directory: string;
  let path: string;
  let service: AuthConfigService;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'webui-auth-config-'));
    path = join(directory, 'auth.json');
    const config = {
      get: (key: string) =>
        key === 'WEBUI_AUTH_CONFIG_PATH' ? path : undefined,
    } as ConfigService;
    service = new AuthConfigService(config);
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('persists configuration atomically with owner-only permissions', () => {
    const result = service.update({
      local: { sessionTtlHours: 12 },
      oidc: {
        issuerUrl: 'https://sso.example.test/application/o/webui/',
        clientId: 'webui',
        clientSecret: 'private-value',
      },
    });

    expect(result.local.sessionTtlHours).toBe(12);
    expect(result.oidc.clientSecretConfigured).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-value');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const persisted = JSON.parse(readFileSync(path, 'utf8')) as {
      oidc: { clientSecret: string };
    };
    expect(persisted.oidc.clientSecret).toBe('private-value');
  });

  it('requires a complete HTTPS OIDC configuration before activation', () => {
    expect(() => service.update({ oidc: { enabled: true } })).toThrow(
      'OIDC issuer, client ID and client secret are required',
    );
    const result = service.update({
      oidc: {
        enabled: true,
        issuerUrl: 'https://sso.example.test/application/o/webui/',
        clientId: 'webui',
        clientSecret: 'private-value',
        redirectUri: 'https://webui.example.test/api/auth/oidc/callback',
      },
    });
    expect(result.oidc.enabled).toBe(true);
    expect(result.oidc.clientSecretConfigured).toBe(true);
  });
});
