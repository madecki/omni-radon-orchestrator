#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPOS_CONF="$WORKSPACE_ROOT/repos.conf"

if [[ ! -f "$REPOS_CONF" ]]; then
  echo "ERROR: repos.conf not found at $REPOS_CONF" >&2
  exit 1
fi

echo "==> Pulling updates for all repositories..."
echo ""

while IFS=' ' read -r name _; do
  [[ -z "$name" || "$name" == \#* ]] && continue

  target="$WORKSPACE_ROOT/$name"

  if [[ ! -d "$target/.git" ]]; then
    echo "  SKIP  $name  (not cloned — run: make clone)"
    continue
  fi

  branch="$(git -C "$target" branch --show-current 2>/dev/null || echo "detached")"
  echo "  PULL  $name  (branch: $branch)"

  if git -C "$target" pull --ff-only 2>&1 | sed 's/^/         /'; then
    echo "  OK    $name"
  else
    echo "  FAIL  $name  — pull failed (diverged or conflict)" >&2
    echo "         Run: cd $name && git status" >&2
  fi
  echo ""
done < "$REPOS_CONF"

echo "==> Done."
