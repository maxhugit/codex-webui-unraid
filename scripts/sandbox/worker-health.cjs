'use strict';
const fs = require('node:fs');
const http = require('node:http');
const token = fs
  .readFileSync('/run/secrets/standard_worker_token', 'utf8')
  .trim();
const request = http.get(
  'http://127.0.0.1:8173/health',
  { headers: { Authorization: `Bearer ${token}` } },
  (res) => {
    res.resume();
    if (res.statusCode !== 200) process.exitCode = 1;
  },
);
request.setTimeout(3000, () => request.destroy(new Error('Timeout')));
request.on('error', () => {
  process.exitCode = 1;
});
