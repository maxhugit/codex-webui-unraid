import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthResourceError,
  readAuthResource,
  shouldRetryPlatformSession,
} from './platform-session';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('platform session recovery', () => {
  it('retries transient transport failures up to three times', () => {
    const networkError = new TypeError('Load failed');

    expect(shouldRetryPlatformSession(0, networkError)).toBe(true);
    expect(shouldRetryPlatformSession(2, networkError)).toBe(true);
    expect(shouldRetryPlatformSession(3, networkError)).toBe(false);
  });

  it('does not retry an expired or forbidden session', () => {
    expect(
      shouldRetryPlatformSession(0, new AuthResourceError('Unauthorized', 401)),
    ).toBe(false);
    expect(
      shouldRetryPlatformSession(0, new AuthResourceError('Forbidden', 403)),
    ).toBe(false);
  });

  it('retries temporary HTTP failures', () => {
    expect(
      shouldRetryPlatformSession(
        0,
        new AuthResourceError('Service unavailable', 503),
      ),
    ).toBe(true);
  });

  it('requests transport recovery when the browser fetch fails locally', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new TypeError('Load failed'),
    );
    const dispatch = vi.spyOn(window, 'dispatchEvent');

    await expect(readAuthResource('me')).rejects.toThrow('Load failed');

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'codex-webui:transport-recover' }),
    );
  });
});
