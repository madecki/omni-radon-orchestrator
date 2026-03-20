#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "╔══════════════════════════════════════════╗"
echo "║   OmniRadon — workspace bootstrap        ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Step 1: Prerequisites ────────────────────────────────────────────────────
echo "--- Step 1: Prerequisites ---"

check_tool() {
  if command -v "$1" &>/dev/null; then
    echo "  OK    $1"
  else
    echo "  MISS  $1  ← required, please install it"
    missing_tools=1
  fi
}

missing_tools=0
check_tool git
check_tool node
check_tool pnpm
check_tool docker

if [[ $missing_tools -ne 0 ]]; then
  echo ""
  echo "ERROR: Missing required tools. Install them and re-run bootstrap." >&2
  exit 1
fi

echo ""

# ── Step 2: Clone repositories ───────────────────────────────────────────────
echo "--- Step 2: Clone repositories ---"
"$WORKSPACE_ROOT/scripts/clone.sh"
echo ""

# ── Step 3: Install dependencies ─────────────────────────────────────────────
echo "--- Step 3: Install dependencies ---"

install_deps() {
  local name="$1"
  local dir="$WORKSPACE_ROOT/$name"

  if [[ ! -d "$dir" ]]; then
    echo "  SKIP  $name  (not cloned)"
    return
  fi

  echo "  INSTALL $name..."
  if (cd "$dir" && pnpm install) >/dev/null 2>&1; then
    echo "  OK    $name"
  else
    echo "  FAIL  $name  — pnpm install failed" >&2
    exit 1
  fi
}

install_deps "shell"
install_deps "gateway"
install_deps "auth-service"
install_deps "diary"

echo ""

# ── Step 4: Environment file check ───────────────────────────────────────────
echo "--- Step 4: Environment files ---"

check_env() {
  local repo="$1"
  local env_file="$2"
  local example_file="$3"
  local dir="$WORKSPACE_ROOT/$repo"

  [[ -d "$dir" ]] || return

  if [[ -f "$dir/$env_file" ]]; then
    echo "  OK    $repo/$env_file"
  elif [[ -f "$dir/$example_file" ]]; then
    echo "  WARN  $repo/$env_file  ← missing, copy from $example_file and fill in values"
    echo "        cp $repo/$example_file $repo/$env_file"
  else
    echo "  WARN  $repo/$env_file  ← missing (no example found)"
  fi
}

check_env "gateway"      ".env" ".env.example"
check_env "auth-service" ".env" ".env.example"

echo ""

# ── Summary ───────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════╗"
echo "║   Bootstrap complete                     ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Resolve any WARN messages above (missing .env files)"
echo "  2. Start Docker Desktop if not already running"
echo "  3. Run:  make dev"
echo ""
echo "Services when running:"
echo "  http://localhost:3000   Gateway (unified entry point)"
echo "  http://localhost:3001   Shell"
echo "  http://localhost:4001   Auth Service"
echo "  http://localhost:4280   Diary Web"
echo "  http://localhost:4281   Diary API"
echo ""
echo "For full details see:  README.md"
