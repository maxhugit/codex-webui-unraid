import { describe, expect, it } from 'vitest';
import type { AppInfoDto } from '@/generated/api/types.gen';
import { availableProjectApps } from './project-integrations-queries';

function app(
  id: string,
  isAccessible: boolean,
  isEnabled: boolean,
): AppInfoDto {
  return { id, isAccessible, isEnabled } as AppInfoDto;
}

describe('availableProjectApps', () => {
  it('keeps only globally enabled apps accessible to the current account', () => {
    expect(
      availableProjectApps([
        app('available', true, true),
        app('disabled', true, false),
        app('inaccessible', false, true),
      ]).map((item) => item.id),
    ).toEqual(['available']);
  });
});
