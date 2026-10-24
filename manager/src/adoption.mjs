import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const ADOPTION_CONFIRMATION = 'ADOPT_EXISTING_INSTALLATION';

function canonicalSnapshot(inventory) {
  return {
    schemaVersion: 1,
    stack: inventory.stack,
    environment: inventory.environment,
    components: [...inventory.components]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((component) => ({
        id: component.id,
        containerId: component.containerId,
        containerName: component.containerName,
        image: component.image,
        networks: [...component.networks].sort(),
        protectedMounts: [...component.protectedMounts]
          .sort((left, right) => left.target.localeCompare(right.target))
          .map((mount) => ({
            target: mount.target,
            source: mount.source,
            type: mount.type,
            writable: mount.writable,
          })),
      })),
  };
}

export function inventoryFingerprint(inventory) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalSnapshot(inventory)))
    .digest('hex');
}

function adoptionBlockers(inventory) {
  const blockers = [...inventory.dataSafety.blockers];
  for (const component of inventory.components) {
    if (!component.containerId)
      blockers.push(`${component.id}:containerUnavailable`);
    if (component.imageRepositoryAllowed === false)
      blockers.push(`${component.id}:imageRepositoryNotAllowed`);
    for (const network of component.missingNetworks)
      blockers.push(`${component.id}:${network}:networkMissing`);
  }
  return [...new Set(blockers)].sort();
}

export function evaluateAdoption(inventory, record = null) {
  const fingerprint = inventoryFingerprint(inventory);
  const blockers = adoptionBlockers(inventory);
  let state = blockers.length === 0 ? 'eligible' : 'blocked';
  if (record) {
    state =
      record.stack === inventory.stack &&
      record.environment === inventory.environment &&
      record.fingerprint === fingerprint
        ? 'adopted'
        : 'drifted';
    if (state === 'drifted') blockers.push('adoptionRecordDrift');
  }
  return {
    ...inventory,
    components: inventory.components.map((component) => ({
      ...component,
      adoption: state === 'adopted' ? 'managed' : component.adoption,
    })),
    adoption: {
      state,
      fingerprint,
      adoptedAt: state === 'adopted' ? record.adoptedAt : null,
      blockers: [...new Set(blockers)].sort(),
      canAdopt: state === 'eligible',
    },
  };
}

export async function readAdoptionRecord(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (
      value?.schemaVersion !== 1 ||
      typeof value.stack !== 'string' ||
      !['production', 'development'].includes(value.environment) ||
      typeof value.fingerprint !== 'string' ||
      !Array.isArray(value.components)
    )
      throw new Error('Invalid adoption record');
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function confirmAdoption({
  inventory,
  existingRecord,
  confirmation,
  expectedFingerprint,
  path,
  now = new Date(),
}) {
  if (confirmation !== ADOPTION_CONFIRMATION)
    throw new Error('adoptionConfirmationRequired');
  const evaluated = evaluateAdoption(inventory, existingRecord);
  if (evaluated.adoption.fingerprint !== expectedFingerprint)
    throw new Error('adoptionInventoryChanged');
  if (!evaluated.adoption.canAdopt) throw new Error('adoptionBlocked');
  const record = {
    ...canonicalSnapshot(inventory),
    fingerprint: evaluated.adoption.fingerprint,
    adoptedAt: now.toISOString(),
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return evaluateAdoption(inventory, record);
}
