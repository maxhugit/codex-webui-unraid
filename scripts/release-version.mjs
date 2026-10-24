#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const STABLE_ZERO_MAJOR = /^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateReleaseVersion(rootVersion, webVersion, refName = '') {
  if (!STABLE_ZERO_MAJOR.test(rootVersion)) {
    throw new Error(
      `Mergeron version must be a stable 0.x.y version, received ${rootVersion}`,
    );
  }
  if (webVersion !== rootVersion) {
    throw new Error(
      `Root and web package versions differ: ${rootVersion} != ${webVersion}`,
    );
  }

  const isRelease = refName.startsWith('v');
  if (isRelease && refName !== `v${rootVersion}`) {
    throw new Error(
      `Release tag ${refName} must match package version v${rootVersion}`,
    );
  }

  return {
    version: rootVersion,
    channel: isRelease ? 'stable' : 'edge',
    isRelease,
  };
}

function packageVersion(path) {
  const value = JSON.parse(readFileSync(path, 'utf8')).version;
  if (typeof value !== 'string') throw new Error(`${path} has no version`);
  return value;
}

export function readBuildVersion(refName = '') {
  return validateReleaseVersion(
    packageVersion(new URL('../package.json', import.meta.url)),
    packageVersion(new URL('../web/package.json', import.meta.url)),
    refName,
  );
}

function main() {
  const result = readBuildVersion(process.argv[2] ?? '');
  const created = new Date().toISOString();
  const output = process.env.GITHUB_OUTPUT;

  if (output) {
    appendFileSync(
      output,
      [
        `version=${result.version}`,
        `channel=${result.channel}`,
        `is_release=${String(result.isRelease)}`,
        `created=${created}`,
        '',
      ].join('\n'),
    );
  }

  console.log(
    `Mergeron ${result.version} (${result.channel})${
      result.isRelease ? ` from ${process.argv[2]}` : ''
    }`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
