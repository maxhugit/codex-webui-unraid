#!/bin/sh
set -u

PID_FILE="${CODEX_NETWORK_PID_FILE:-/var/run/codex-webui-network-reconciler.pid}"
RETRY_DELAY="${CODEX_NETWORK_RETRY_DELAY:-5}"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"
}

container_exists() {
  docker container inspect "$1" >/dev/null 2>&1
}

network_exists() {
  docker network inspect "$1" >/dev/null 2>&1
}

container_has_network() {
  docker container inspect \
    --format "{{if index .NetworkSettings.Networks \"$2\"}}yes{{end}}" \
    "$1" 2>/dev/null | grep -qx yes
}

ensure_connection() {
  container="$1"
  network="$2"

  if ! container_exists "$container"; then
    log "Conteneur absent, raccordement différé: $container"
    return 1
  fi

  if ! network_exists "$network"; then
    log "Réseau absent, raccordement différé: $network"
    return 1
  fi

  if container_has_network "$container" "$network"; then
    return 0
  fi

  if docker network connect "$network" "$container"; then
    log "Réseau raccordé: $container -> $network"
    return 0
  fi

  log "Échec du raccordement: $container -> $network"
  return 1
}

reconcile_container() {
  container_result=0
  case "$1" in
    codex-webui)
      ensure_connection codex-webui codex_isolated || container_result=1
      ensure_connection codex-webui codex_admin || container_result=1
      ;;
    codex-web-ingress)
      ensure_connection codex-web-ingress codex_isolated || container_result=1
      ensure_connection codex-web-ingress net_standard || container_result=1
      ;;
    codex-web-squid)
      ensure_connection codex-web-squid codex_isolated || container_result=1
      ensure_connection codex-web-squid codex_external || container_result=1
      ;;
    *)
      return 0
      ;;
  esac
  return "$container_result"
}

reconcile_all() {
  all_result=0
  reconcile_container codex-web-squid || all_result=1
  reconcile_container codex-webui || all_result=1
  reconcile_container codex-web-ingress || all_result=1
  return "$all_result"
}

run_watch() {
  if [ -f "$PID_FILE" ]; then
    existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    existing_command="$(ps -p "$existing_pid" -o args= 2>/dev/null || true)"
    if [ -n "$existing_pid" ] && [ "$existing_command" = "$0 watch" ]; then
      log "Le réconciliateur est déjà actif (PID $existing_pid)."
      return 0
    fi
  fi

  printf '%s\n' "$$" > "$PID_FILE"
  trap 'rm -f "$PID_FILE"' EXIT
  trap 'exit 0' HUP INT TERM

  log "Surveillance des réseaux DockerMan démarrée."
  while :; do
    if docker info >/dev/null 2>&1; then
      reconcile_all || true
    fi
    sleep "$RETRY_DELAY"
  done
}

case "${1:-once}" in
  once)
    reconcile_all
    ;;
  watch)
    run_watch
    ;;
  *)
    echo "Usage: $0 [once|watch]" >&2
    exit 2
    ;;
esac
