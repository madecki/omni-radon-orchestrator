#!/usr/bin/env bash
# Tail workspace logs: all services in one terminal (with [service] prefix)
# or a single service. Usage:
#   ./scripts/logs.sh              → all services, prefixed
#   ./scripts/logs.sh gateway       → only gateway
#   ./scripts/logs.sh gateway shell → only gateway and shell, prefixed
set -euo pipefail

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS_DIR="$WORKSPACE_ROOT/logs"

# Kill background tail processes on exit (e.g. Ctrl+C)
cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT INT TERM

mkdir -p "$LOGS_DIR"

# Service names that have log files (must match start_service names in dev.sh)
SERVICES=(auth-service diary gateway shell)

tail_one_with_prefix() {
  local name="$1"
  local log="$LOGS_DIR/$name.log"
  if [[ -f "$log" ]]; then
    tail -f "$log" | sed "s/^/[$name] /"
  else
    echo "[$name] (no log file yet: $log)" >&2
  fi
}

tail_one_raw() {
  local name="$1"
  local log="$LOGS_DIR/$name.log"
  if [[ -f "$log" ]]; then
    tail -f "$log"
  else
    echo "No log file: $log" >&2
    exit 1
  fi
}

if [[ $# -eq 0 ]]; then
  # All services in one terminal, prefixed
  for name in "${SERVICES[@]}"; do
    log="$LOGS_DIR/$name.log"
    if [[ -f "$log" ]]; then
      tail -f "$log" | sed "s/^/[$name] /" &
    else
      echo "[$name] (no log file yet: $log)" >&2
    fi
  done
  wait
elif [[ $# -eq 1 ]]; then
  # Single service: no prefix
  tail_one_raw "$1"
else
  # Multiple services: prefixed
  for name in "$@"; do
    log="$LOGS_DIR/$name.log"
    if [[ -f "$log" ]]; then
      tail -f "$log" | sed "s/^/[$name] /" &
    else
      echo "[$name] (no log file yet: $log)" >&2
    fi
  done
  wait
fi
