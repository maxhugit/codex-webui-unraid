#!/bin/sh
set -eu

MERGERON_BACKEND_TOKEN="$(cat /run/secrets/backend_token)"
export MERGERON_BACKEND_TOKEN

envsubst '${MERGERON_BACKEND_TOKEN}' \
  < /etc/nginx/templates-secure/nginx.conf.template \
  > /tmp/nginx.conf

exec nginx -c /tmp/nginx.conf -g 'daemon off;'
