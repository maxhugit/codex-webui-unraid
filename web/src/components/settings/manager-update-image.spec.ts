import { expect, it } from 'vitest';
import type { ManagerStatus } from './manager-status-api';
import { defaultManagerUpdateImage } from './manager-update-image';
import type { ServerReleaseStatus } from './server-release-api';

function status(
  environment?: ManagerStatus['environment'],
  image = 'ghcr.io/maxhugit/mergeron:0.1.0',
): ManagerStatus {
  return {
    available: true,
    mode: 'observe',
    environment,
    dockerConnected: true,
    components: [{ id: 'application', image }] as ManagerStatus['components'],
    dataSafety: { status: 'protected', blockers: [], protectedMounts: [] },
  };
}

const release = {
  latestVersion: '0.1.1',
  installed: { channel: 'stable', version: '0.1.0' },
  versionStatus: 'update_available',
} as ServerReleaseStatus;

it('defaults production to the latest published stable version', () => {
  expect(defaultManagerUpdateImage(status('production'), release)).toBe(
    'ghcr.io/maxhugit/mergeron:0.1.1',
  );
});

it('keeps the installed stable version when release discovery is unavailable', () => {
  expect(defaultManagerUpdateImage(status('production'))).toBe(
    'ghcr.io/maxhugit/mergeron:0.1.0',
  );
});

it('does not assume development when an older Manager omits the environment', () => {
  expect(defaultManagerUpdateImage(status(), release)).toBe(
    'ghcr.io/maxhugit/mergeron:0.1.1',
  );
});

it('offers edge for development even when a stable release exists', () => {
  expect(defaultManagerUpdateImage(status('development'), release)).toBe(
    'ghcr.io/maxhugit/mergeron:edge',
  );
});

it('falls back to the stable alias rather than edge for an unknown production image', () => {
  expect(
    defaultManagerUpdateImage(
      status('production', 'ghcr.io/maxhugit/mergeron:edge'),
    ),
  ).toBe('ghcr.io/maxhugit/mergeron:latest');
});

it.each(['edge', '0.1.1-rc.1', 'v0.1.1', ''])(
  'does not treat %s as a stable published version',
  (version) => {
    expect(
      defaultManagerUpdateImage(status('production'), {
        ...release,
        latestVersion: version,
      }),
    ).toBe('ghcr.io/maxhugit/mergeron:0.1.0');
  },
);

it('does not propose a downgrade when the installed stable release is ahead', () => {
  expect(
    defaultManagerUpdateImage(
      status('production', 'ghcr.io/maxhugit/mergeron:0.1.2'),
      { ...release, versionStatus: 'ahead' },
    ),
  ).toBe('ghcr.io/maxhugit/mergeron:0.1.2');
});

it('uses stable build metadata when the installed image is pinned by digest', () => {
  expect(
    defaultManagerUpdateImage(
      status('production', 'ghcr.io/maxhugit/mergeron@sha256:abc'),
      { ...release, latestVersion: null },
    ),
  ).toBe('ghcr.io/maxhugit/mergeron:0.1.0');
});

it('does not downgrade with stale cached release metadata after an upgrade', () => {
  expect(
    defaultManagerUpdateImage(
      status('production', 'ghcr.io/maxhugit/mergeron:0.1.2'),
      release,
    ),
  ).toBe('ghcr.io/maxhugit/mergeron:0.1.2');
});
