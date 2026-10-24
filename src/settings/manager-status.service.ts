/** Read-only bridge to the local Mergeron Manager Unix socket. */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import http from 'node:http';

const MAX_RESPONSE_BYTES = 1024 * 1024;

@Injectable()
export class ManagerStatusService {
  constructor(private readonly config: ConfigService) {}

  private socketPath(): string {
    return (
      this.config.get<string>('MERGERON_MANAGER_SOCKET') ??
      '/run/mergeron-manager/manager.sock'
    );
  }

  protected requestManager(): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          method: 'GET',
          path: '/v1/status',
          socketPath: this.socketPath(),
          timeout: 3_000,
          headers: { Accept: 'application/json' },
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
            if (body.length > MAX_RESPONSE_BYTES)
              request.destroy(new Error('Manager response is too large'));
          });
          response.on('end', () => {
            if (response.statusCode !== 200) {
              reject(
                new Error(
                  `Mergeron Manager returned HTTP ${response.statusCode ?? 'unknown'}`,
                ),
              );
              return;
            }
            try {
              const value: unknown = JSON.parse(body);
              if (!value || typeof value !== 'object' || Array.isArray(value))
                throw new Error('Invalid Manager response');
              resolve(value as Record<string, unknown>);
            } catch (error) {
              reject(
                error instanceof Error
                  ? error
                  : new Error('Invalid Manager response'),
              );
            }
          });
        },
      );
      request.on('timeout', () =>
        request.destroy(new Error('Mergeron Manager timeout')),
      );
      request.on('error', reject);
      request.end();
    });
  }

  async status() {
    try {
      return { available: true, ...(await this.requestManager()) };
    } catch {
      return {
        available: false,
        mode: 'observe',
        dockerConnected: false,
        components: [],
        dataSafety: {
          status: 'unknown',
          blockers: [],
          protectedMounts: [],
        },
        error: 'mergeronManagerUnavailable',
      };
    }
  }
}
