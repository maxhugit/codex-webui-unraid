import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { ManagerStatusService } from './manager-status.service';

class FixtureManagerStatusService extends ManagerStatusService {
  constructor(private readonly result: Record<string, unknown> | Error) {
    super(new ConfigService());
  }

  protected override requestManager(): Promise<Record<string, unknown>> {
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}

describe('ManagerStatusService', () => {
  it('returns the observe-only inventory without modifying it', async () => {
    const service = new FixtureManagerStatusService({
      mode: 'observe',
      dockerConnected: true,
      components: [{ id: 'application', state: 'healthy' }],
      dataSafety: { status: 'protected' },
    });
    await expect(service.status()).resolves.toEqual({
      available: true,
      mode: 'observe',
      dockerConnected: true,
      components: [{ id: 'application', state: 'healthy' }],
      dataSafety: { status: 'protected' },
    });
  });

  it('reports an unavailable manager without claiming that the stack is healthy', async () => {
    const service = new FixtureManagerStatusService(new Error('offline'));
    await expect(service.status()).resolves.toMatchObject({
      available: false,
      mode: 'observe',
      dockerConnected: false,
      components: [],
      dataSafety: { status: 'unknown' },
      error: 'mergeronManagerUnavailable',
    });
  });

  it('forwards explicit adoption confirmation to the local manager', async () => {
    class AdoptionFixture extends ManagerStatusService {
      request: unknown[] | null = null;

      protected override requestManager(
        path?: string,
        method?: 'GET' | 'POST',
        payload?: Record<string, unknown>,
      ): Promise<Record<string, unknown>> {
        this.request = [path, method, payload];
        return Promise.resolve({ adoption: { state: 'adopted' } });
      }
    }
    const service = new AdoptionFixture(new ConfigService());
    await expect(
      service.adopt({
        confirmation: 'ADOPT_EXISTING_INSTALLATION',
        expectedFingerprint: 'fingerprint',
      }),
    ).resolves.toEqual({
      available: true,
      adoption: { state: 'adopted' },
    });
    expect(service.request).toEqual([
      '/v1/adoption',
      'POST',
      {
        confirmation: 'ADOPT_EXISTING_INSTALLATION',
        expectedFingerprint: 'fingerprint',
      },
    ]);
  });
});
