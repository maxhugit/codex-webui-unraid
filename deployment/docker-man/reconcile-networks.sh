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

  if docker network connect --alias "$legacy_alias" "$network" "$container"; then
    log "Réseau raccordé: $container -> $network"
    return 0
  fi

  log "Échec du raccordement: $container -> $network"
  return 1
}

reconcile_container() {
  container_result=0
  case "$1" in
    mergeron|codex-webui)
      legacy_alias=codex-webui
      ensure_connection "$1" codex_isolated || container_result=1
      ensure_connection "$1" codex_admin || container_result=1
      ;;
    mergeron-ingress|codex-web-ingress)
      legacy_alias=codex-web-ingress
      ensure_connection "$1" codex_isolated || container_result=1
      ensure_connection "$1" net_standard || container_result=1
      ;;
    mergeron-squid|codex-web-squid)
      legacy_alias=codex-web-squid
      ensure_connection "$1" codex_isolated || container_result=1
      ensure_connection "$1" codex_external || container_result=1
      ;;
    *)
      return 0
      ;;
  esac
  return "$container_result"
}

reconcile_all() {
  all_result=0
  for pair in 'mergeron-squid:codex-web-squid' 'mergeron:codex-webui' 'mergeron-ingress:codex-web-ingress'; do
    preferred="${pair%%:*}"
    legacy="${pair#*:}"
    if container_exists "$preferred"; then
      reconcile_container "$preferred" || all_result=1
    else
      reconcile_container "$legacy" || all_result=1
    fi
  done
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
