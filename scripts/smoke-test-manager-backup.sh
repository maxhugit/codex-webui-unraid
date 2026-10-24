#!/usr/bin/env bash
set -euo pipefail
image=${1:?Manager image required}
fixture_volume=$(docker volume create --label io.mergeron.test=manager-backup)
trap 'docker volume rm "$fixture_volume" >/dev/null' EXIT
docker run --rm --network none --read-only --cap-drop ALL --cap-add CHOWN --cap-add DAC_READ_SEARCH --security-opt no-new-privileges:true \
  -v "$fixture_volume:/fixture" --entrypoint /nodejs/bin/node "$image" --input-type=module -e '
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { copyPersistentTree, restorePersistentEntry } from "/opt/mergeron-manager/src/updater.mjs";
await fs.mkdir("/fixture/home", {mode: 0o700});
await fs.writeFile("/fixture/home/database", "private-state", {mode: 0o600});
await fs.chown("/fixture/home/database", 11002, 11002);
await fs.symlink("/outside-the-fixture", "/fixture/home/link");
await fs.chown("/fixture/home", 11002, 11002);
await copyPersistentTree("/fixture/home", "/fixture/backup");
assert.equal(await fs.readFile("/fixture/backup/database", "utf8"), "private-state");
const copied = await fs.stat("/fixture/backup/database");
assert.equal(copied.uid, 11002); assert.equal(copied.gid, 11002); assert.equal(copied.mode & 0o777, 0o600);
assert.equal((await fs.stat("/fixture/backup")).mode & 0o777, 0o700);
assert.equal(await fs.readlink("/fixture/backup/link"), "/outside-the-fixture");
await fs.mkdir("/fixture/operation/backup", {recursive: true});
await copyPersistentTree("/fixture/home", "/fixture/operation/backup/home");
// Write as the owner would, without depending on DAC_OVERRIDE in this fixture.
await fs.chown("/fixture/home/database", 0, 0);
await fs.writeFile("/fixture/home/database", "newer-state");
await fs.chown("/fixture/home/database", 11002, 11002);
await restorePersistentEntry("/fixture", "/fixture/operation", "test-operation", "home");
assert.equal(await fs.readFile("/fixture/home/database", "utf8"), "private-state");
assert.equal(await fs.readFile("/fixture/operation/quarantine/home/database", "utf8"), "newer-state");
assert.equal((await fs.stat("/fixture/home")).uid, 11002);
assert.equal((await fs.stat("/fixture/home/database")).mode & 0o777, 0o600);
console.log("Manager backup and rollback preserve private data, ownership and permissions with minimal capabilities.");
'
