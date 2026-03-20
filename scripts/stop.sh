#!/usr/bin/env bash

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS_DIR="$WORKSPACE_ROOT/.pids"

# Ports used by the stack (fallback: kill by port if PID didn't work)
STACK_PORTS="3000 3001 4001 4280 4281 5433 54320 42220"

echo "==> Stopping services..."

if [[ -d "$PIDS_DIR" ]]; then
  for pid_file in "$PIDS_DIR"/*.pid; do
    [[ -f "$pid_file" ]] || continue

    name="$(basename "$pid_file" .pid)"
    pid="$(cat "$pid_file")"

    if kill -0 "$pid" 2>/dev/null; then
      echo "  STOP  $name  (pid $pid)"
      # Kill entire process group (subshell + pnpm + node and all children)
      kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      sleep 1
      kill -0 "$pid" 2>/dev/null && kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    else
      echo "  SKIP  $name  (not running)"
    fi

    rm -f "$pid_file"
  done
fi

# Fallback: kill anything still listening on stack ports (e.g. if trap didn't run)
for port in $STACK_PORTS; do
  pids=$(lsof -ti tcp:"$port" 2>/dev/null) || true
  if [[ -n "$pids" ]]; then
    echo "  KILL  port $port (pids: $pids)"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
done

echo "==> Done."
