import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import {
  createTestDatabase,
  type TestDatabase,
} from '../database/database.testing';
import { DRIZZLE_DB } from '../database/database.constants';
import { people } from '../database/schema';
import { SettingsController } from '../settings/settings.controller';
import { SettingsService } from '../settings/settings.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ApiKeyGuard } from './api-key.guard';
import { PlatformAccessGuard } from './platform-access.guard';
import { IdentityService } from './identity.service';
import { ProjectsController } from '../projects/projects.controller';
import { ProjectsService } from '../projects/projects.service';

let app: NestFastifyApplication;
let database: TestDatabase;
const proxyHeaders = (email = 'standard@example.com') => ({
  authorization: 'Bearer isolated-http-test',
  'x-webui-auth-source': 'authentik',
  'x-webui-auth-subject': email,
  'x-webui-auth-email': email,
});
beforeEach(async () => {
  vi.stubEnv('WEBUI_REQUIRE_IDENTITY', 'true');
  database = createTestDatabase();
  database.db
    .insert(people)
    .values(
      ['standard', 'administrator'].map((role) => ({
        id: role,
        reference: role,
        name: `Test ${role}`,
        firstName: 'Test',
        lastName: role,
        email: `${role}@example.com`,
        phone: '0600000000',
        role: role as 'standard' | 'administrator',
        identitySubject:
          role === 'administrator' ? `${role}@example.com` : null,
        createdAt: 1,
        updatedAt: 1,
      })),
    )
    .run();
  const projects = new ProjectsService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    database.db,
  );
  const module = await Test.createTestingModule({
    imports: [JwtModule.register({})],
    controllers: [AuthController, SettingsController, ProjectsController],
    providers: [
      AuthService,
      IdentityService,
      { provide: DRIZZLE_DB, useValue: database.db },
      { provide: ProjectsService, useValue: projects },
      {
        provide: ConfigService,
        useValue: new ConfigService({ WEBUI_API_KEY: 'isolated-http-test' }),
      },
      {
        provide: SettingsService,
        useValue: {
          listSettings: () => [
            { key: 'private-test-setting', value: 'not-for-standard-users' },
          ],
        },
      },
      { provide: APP_GUARD, useClass: ApiKeyGuard },
      { provide: APP_GUARD, useClass: PlatformAccessGuard },
    ],
  }).compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  app.setGlobalPrefix('api');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterEach(async () => {
  await app.close();
  database.sqlite.close();
  vi.unstubAllEnvs();
});

it('returns 403 on real settings routes for standard users and 200 for administrators', async () => {
  const server = app.getHttpAdapter().getInstance();
  const standard = await server.inject({
    method: 'GET',
    url: '/api/settings',
    headers: proxyHeaders(),
  });
  expect(standard.statusCode).toBe(403);
  expect(standard.body).not.toContain('not-for-standard-users');
  expect(
    (
      await server.inject({
        method: 'GET',
        url: '/api/settings',
        headers: proxyHeaders('administrator@example.com'),
      })
    ).statusCode,
  ).toBe(200);
});

it('does not trust a browser marker or a forged role without backend bearer authentication', async () => {
  const response = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'GET',
      url: '/api/settings',
      headers: {
        ...proxyHeaders('administrator@example.com'),
        authorization: 'Bearer authentik-proxy',
        'x-webui-role': 'administrator',
      },
    });
  expect(response.statusCode).toBe(401);
});

it('redacts personal contact data from standard user lists and blocks role escalation through people updates', async () => {
  const server = app.getHttpAdapter().getInstance();
  const response = await server.inject({
    method: 'GET',
    url: '/api/projects/people',
    headers: proxyHeaders(),
  });
  expect(response.statusCode).toBe(200);
  expect(response.body).not.toContain('0600000000');
  expect(response.body).not.toContain('identitySubject');
  expect(response.body).not.toContain('email');
  expect(
    (
      await server.inject({
        method: 'PATCH',
        url: '/api/projects/people/standard',
        headers: proxyHeaders(),
        payload: { role: 'administrator' },
      })
    ).statusCode,
  ).toBe(403);
});

it('creates a person with required contacts and a computed full name through the administrator API', async () => {
  const response = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/projects/people',
      headers: proxyHeaders('administrator@example.com'),
      payload: {
        reference: 'NEW',
        firstName: 'Alice',
        lastName: 'Test',
        name: 'untrusted name',
        email: 'Alice@example.com',
        phone: '0600000002',
        role: 'standard',
      },
    });
  expect(response.statusCode).toBe(201);
  expect(response.json<{ person: unknown }>().person).toMatchObject({
    name: 'Alice Test',
    email: 'alice@example.com',
    role: 'standard',
  });
});
