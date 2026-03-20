#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPOS_CONF="$WORKSPACE_ROOT/repos.conf"

if [[ ! -f "$REPOS_CONF" ]]; then
  echo "ERROR: repos.conf not found at $REPOS_CONF" >&2
  exit 1
fi

echo "==> Cloning repositories..."
echo ""

had_error=0

while IFS=' ' read -r name url; do
  [[ -z "$name" || "$name" == \#* ]] && continue

  target="$WORKSPACE_ROOT/$name"

  if [[ -d "$target/.git" ]]; then
    echo "  SKIP  $name  (already cloned)"
    continue
  fi

  echo "  CLONE $name  ← $url"
  if git clone "$url" "$target"; then
    echo "  OK    $name"
  else
    echo "  FAIL  $name  — git clone failed" >&2
    had_error=1
  fi
done < "$REPOS_CONF"

echo ""

if [[ $had_error -ne 0 ]]; then
  echo "ERROR: One or more repositories failed to clone." >&2
  echo "       Check your SSH keys and remote URLs in repos.conf." >&2
  exit 1
fi

echo "==> Done."
