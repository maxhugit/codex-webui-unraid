import type { ManagerStatus } from './manager-status-api';
import type { ServerReleaseStatus } from './server-release-api';

const repository = 'ghcr.io/maxhugit/mergeron';
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function defaultManagerUpdateImage(
  status: ManagerStatus,
  release?: ServerReleaseStatus,
): string {
  if (
    release?.targetImage === `${repository}:edge` ||
    release?.targetImage === `${repository}:latest`
  )
    return release.targetImage;
  if (status.environment === 'development') return `${repository}:edge`;

  // Treat an unknown environment conservatively, including older Managers.
  const installedImage = status.components.find(
    (component) => component.id === 'application',
  )?.image;
  const currentTag = installedImage?.startsWith(`${repository}:`)
    ? installedImage.slice(repository.length + 1)
    : undefined;
  const installedVersion =
    currentTag && stableVersion.test(currentTag)
      ? currentTag
      : release?.installed.channel === 'stable' &&
          stableVersion.test(release.installed.version ?? '')
        ? release.installed.version
        : undefined;
  const publishedVersion =
    release?.latestVersion && stableVersion.test(release.latestVersion)
      ? release.latestVersion
      : undefined;
  // Do not offer an older release when the installed stable version is ahead.
  const target =
    installedVersion &&
    publishedVersion &&
    compareVersions(installedVersion, publishedVersion) > 0
      ? installedVersion
      : (publishedVersion ?? installedVersion ?? 'latest');
  return `${repository}:${target}`;
}
