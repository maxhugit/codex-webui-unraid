import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase } from '../database/database.testing';
import { oidcAuthFlows } from '../database/schema';
import { AuthConfigService } from './auth-config.service';
import type { IdentityService } from './identity.service';
import type { LocalAuthService } from './local-auth.service';
import { OidcAuthService } from './oidc-auth.service';

const oidcMocks = vi.hoisted(() => ({
  claims: vi.fn(() => ({
    sub: 'authentik-subject',
    email: 'member@example.test',
    email_verified: true,
  })),
  discovery: vi.fn(),
  authorizationCodeGrant: vi.fn(),
}));

vi.mock('openid-client', () => ({
  randomState: () => 'state-value',
  randomPKCECodeVerifier: () => 'code-verifier',
  randomNonce: () => 'nonce-value',
  calculatePKCECodeChallenge: vi.fn(() => Promise.resolve('code-challenge')),
  discovery: oidcMocks.discovery,
  enableNonRepudiationChecks: vi.fn(),
  buildAuthorizationUrl: vi.fn(
    (_configuration: unknown, parameters: Record<string, string>) => {
      const url = new URL('https://sso.example.test/authorize');
      for (const [key, value] of Object.entries(parameters))
        url.searchParams.set(key, value);
      return url;
    },
  ),
  authorizationCodeGrant: oidcMocks.authorizationCodeGrant,
}));

describe('OidcAuthService', () => {
  const database = createTestDatabase();
  let directory: string;
  let configuration: AuthConfigService;
  let identities: Pick<IdentityService, 'resolveOidc'>;
  let sessions: Pick<LocalAuthService, 'createSession'>;
  let service: OidcAuthService;

  beforeEach(() => {
    database.db.delete(oidcAuthFlows).run();
    directory = mkdtempSync(join(tmpdir(), 'webui-oidc-'));
    configuration = new AuthConfigService({
      get: (key: string) =>
        key === 'WEBUI_AUTH_CONFIG_PATH'
          ? join(directory, 'auth.json')
          : undefined,
    } as ConfigService);
    configuration.update({
      oidc: {
        enabled: true,
        issuerUrl: 'https://sso.example.test/application/o/webui/',
        clientId: 'webui',
        clientSecret: 'private-value',
        redirectUri: 'https://webui.example.test/api/auth/oidc/callback',
      },
    });
    identities = {
      resolveOidc: vi.fn(() => ({
        kind: 'person',
        personId: 'person-1',
        name: 'Member',
        role: 'standard',
        active: true,
      })),
    };
    sessions = {
      createSession: vi.fn(() => ({
        token: 'session-token',
        personId: 'person-1',
        expiresAt: Date.now() + 60_000,
      })),
    };
    const discovered = {
      serverMetadata: () => ({
        authorization_endpoint: 'https://sso.example.test/authorize',
        token_endpoint: 'https://sso.example.test/token',
        jwks_uri: 'https://sso.example.test/jwks',
      }),
    };
    oidcMocks.discovery.mockResolvedValue(discovered);
    oidcMocks.authorizationCodeGrant.mockResolvedValue({
      claims: oidcMocks.claims,
    });
    service = new OidcAuthService(
      database.db,
      configuration,
      identities as IdentityService,
      sessions as LocalAuthService,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });
  afterAll(() => database.sqlite.close());

  it('uses discovery, PKCE, nonce and a browser-bound single-use state', async () => {
    await service.validateConfiguration(configuration.get().oidc);
    const start = await service.start('/projects/example', true);

    expect(start.authorizationUrl).toContain('code_challenge=code-challenge');
    expect(start.authorizationUrl).toContain('nonce=nonce-value');
    expect(start.cookie).toContain('HttpOnly');
    expect(start.cookie).toContain('Secure');
    expect(database.db.select().from(oidcAuthFlows).all()).toHaveLength(1);

    const result = await service.callback(
      { code: 'authorization-code', state: 'state-value' },
      start.cookie,
      'browser',
    );

    expect(result.returnTo).toBe('/projects/example');
    expect(result.session.token).toBe('session-token');
    expect(identities.resolveOidc).toHaveBeenCalledWith(
      'authentik-subject',
      'member@example.test',
      true,
    );
    expect(database.db.select().from(oidcAuthFlows).all()).toHaveLength(0);
    await expect(
      service.callback(
        { code: 'authorization-code', state: 'state-value' },
        start.cookie,
      ),
    ).rejects.toThrow('OIDC authentication request has expired');
  });

  it('rejects callbacks that are not bound to the initiating browser', async () => {
    await service.start('/', true);
    await expect(
      service.callback(
        { code: 'authorization-code', state: 'state-value' },
        'codex_webui_oidc_state=another-state',
      ),
    ).rejects.toThrow('Invalid or missing OIDC state');
  });
});
