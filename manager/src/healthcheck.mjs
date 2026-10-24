import http from 'node:http';

const request = http.request(
  {
    method: 'GET',
    path: '/healthz',
    socketPath:
      process.env.MERGERON_MANAGER_SOCKET ??
      '/run/mergeron-manager/manager.sock',
    timeout: 2_000,
  },
  (response) => {
    response.resume();
    process.exit(response.statusCode === 200 ? 0 : 1);
  },
);
request.on('timeout', () => request.destroy(new Error('timeout')));
request.on('error', () => process.exit(1));
request.end();
