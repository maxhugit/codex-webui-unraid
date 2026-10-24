import http from 'node:http';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export class DockerClient {
  constructor(socketPath = '/var/run/docker.sock') {
    this.socketPath = socketPath;
  }

  request(path) {
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          method: 'GET',
          path,
          socketPath: this.socketPath,
          headers: { Accept: 'application/json' },
          timeout: 5_000,
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
            if (body.length > MAX_RESPONSE_BYTES) {
              request.destroy(new Error('Docker response is too large'));
            }
          });
          response.on('end', () => {
            if (!response.statusCode || response.statusCode >= 300) {
              reject(
                new Error(
                  `Docker API returned HTTP ${response.statusCode ?? 'unknown'}`,
                ),
              );
              return;
            }
            try {
              resolve(JSON.parse(body));
            } catch {
              reject(new Error('Docker API returned invalid JSON'));
            }
          });
        },
      );
      request.on('timeout', () =>
        request.destroy(new Error('Docker API timeout')),
      );
      request.on('error', reject);
      request.end();
    });
  }

  listContainers() {
    return this.request('/containers/json?all=1');
  }

  inspectContainer(id) {
    return this.request(`/containers/${encodeURIComponent(id)}/json`);
  }
}
