#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS_DIR="$WORKSPACE_ROOT/logs"
PIDS_DIR="$WORKSPACE_ROOT/.pids"

mkdir -p "$LOGS_DIR" "$PIDS_DIR"

# ── Cleanup on exit ───────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "==> Shutting down services..."
  "$WORKSPACE_ROOT/scripts/stop.sh"
  echo "==> Stopped."
}
trap cleanup EXIT INT TERM

# Use process groups so killing the leader kills pnpm/node and all children.
# With set -m, background jobs get their own process group; $! is the group leader.
set -m

# ── Start a service in the background ─────────────────────────────────────────
start_service() {
  local name="$1"
  local rel_dir="$2"
  local cmd="$3"
  local dir="$WORKSPACE_ROOT/$rel_dir"
  local log="$LOGS_DIR/$name.log"

  if [[ ! -d "$dir" ]]; then
    echo "  SKIP  $name  (directory $rel_dir not found — run: make clone)"
    return
  fi

  echo "  START $name  → logs/$name.log"

  (
    cd "$dir"
    eval "$cmd"
  ) >"$log" 2>&1 &

  # $! is the process group leader when set -m is on; we kill the whole group in stop.sh
  echo $! >"$PIDS_DIR/$name.pid"
}

# ── Stack startup ─────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   OmniRadon — starting dev stack         ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Docker must be running before proceeding."
echo ""

# auth-service: starts Docker Compose (Postgres), Prisma migrate, then NestJS
# diary:        starts Docker Compose (Postgres + NATS), Prisma migrate, then Turbo
# shell/gateway: plain Next.js / NestJS dev servers
start_service "auth-service" "auth-service" "pnpm dev"
start_service "diary"        "diary"        "pnpm start"

echo ""
echo "  Waiting 15s for databases and infra to become ready..."
sleep 15

start_service "shell"   "shell"   "pnpm dev"
start_service "gateway" "gateway" "pnpm dev"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   Stack is starting — services:                      ║"
echo "║                                                      ║"
echo "║   Gateway      →  http://localhost:3000  (entry)     ║"
echo "║   Shell        →  http://localhost:3001              ║"
echo "║   Auth Service →  http://localhost:4001              ║"
echo "║   Diary Web    →  http://localhost:4280              ║"
echo "║   Diary API    →  http://localhost:4281              ║"
echo "║                                                      ║"
echo "║   Logs:    ./logs/<service>.log                      ║"
echo "║   Tail:    make logs                                 ║"
echo "║   Stop:    Ctrl+C  or  make stop                     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Keep alive until Ctrl+C
wait
