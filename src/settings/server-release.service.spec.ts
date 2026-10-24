import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractMergeronReleaseSections,
  type GithubRelease,
  ServerReleaseService,
} from './server-release.service';

const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as ConfigService;

const githubRelease = (version: string, body = '') => ({
  tag_name: `v${version}`,
  body,
  html_url: `https://github.com/maxhugit/mergeron/releases/tag/v${version}`,
  published_at: `2026-10-${version.endsWith('.1') ? '21' : '20'}T10:00:00Z`,
  draft: false,
  prerelease: false,
});

class FixtureServerReleaseService extends ServerReleaseService {
  constructor(
    configuration: ConfigService,
    private readonly result: GithubRelease[] | Error,
  ) {
    super(configuration);
  }

  protected override fetchPublishedReleases(): Promise<GithubRelease[]> {
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}

describe('ServerReleaseService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports newer stable releases and only returns cumulative notes after the installed version', async () => {
    const service = new FixtureServerReleaseService(
      config({
        MERGERON_BUILD_INFO_FILE: '/missing/build-info.json',
        MERGERON_VERSION: '0.1.0',
        MERGERON_REVISION: 'abc123',
        MERGERON_BUILD_DATE: '2026-10-20T09:00:00Z',
        MERGERON_RELEASE_CHANNEL: 'stable',
      }),
      [
        githubRelease('0.2.1', '### Corrections\n- Corrige le démarrage.'),
        githubRelease('0.1.0', '### Nouveautés\n- Première version.'),
        githubRelease('0.2.0', '### Nouveautés\n- Ajoute la recherche.'),
      ],
    );

    await expect(service.status()).resolves.toMatchObject({
      installed: {
        version: '0.1.0',
        revision: 'abc123',
        channel: 'stable',
      },
      latestVersion: '0.2.1',
      updateAvailable: true,
      versionStatus: 'update_available',
      releases: [{ version: '0.2.0' }, { version: '0.2.1' }],
      checkError: null,
    });
  });

  it('does not claim the installation is current when discovery fails', async () => {
    const service = new FixtureServerReleaseService(
      config({
        MERGERON_BUILD_INFO_FILE: '/missing/build-info.json',
        MERGERON_VERSION: '0.1.0',
        MERGERON_RELEASE_CHANNEL: 'edge',
      }),
      new Error('offline'),
    );

    await expect(service.status()).resolves.toMatchObject({
      installed: { version: '0.1.0', channel: 'edge' },
      latestVersion: null,
      updateAvailable: false,
      versionStatus: 'unknown',
      releases: [],
      checkError: 'unableToCheckForMergeronUpdates',
    });
  });
});

it('extracts bounded inert sections from generated GitHub notes', () => {
  expect(
    extractMergeronReleaseSections(
      "## What's Changed\n### Nouveautés\n- Ajoute [la recherche](https://example.test) avec `FTS`.\n### Corrections\n- **Corrige** le mobile.",
    ),
  ).toEqual([
    { heading: 'Nouveautés', items: ['Ajoute la recherche avec FTS.'] },
    { heading: 'Corrections', items: ['Corrige le mobile.'] },
  ]);
});
