#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p keys output assets

missing=0

check_cmd() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    printf "ok: %s -> %s\n" "$name" "$(command -v "$name")"
    case "$name" in
      solana) solana --version || true ;;
      spl-token) spl-token --version || true ;;
      node) node --version || true ;;
      npm) npm --version || true ;;
    esac
  else
    printf "missing: %s\n" "$name"
    missing=1
  fi
}

echo "Checking required tools..."
check_cmd solana
check_cmd spl-token
check_cmd node
check_cmd npm

if [ -d node_modules ]; then
  echo "ok: node_modules present"
else
  echo "missing: node_modules; run npm install"
  missing=1
fi

if npx --yes tsx --version >/dev/null 2>&1; then
  echo "ok: tsx available through npx"
else
  echo "missing: tsx; run npm install"
  missing=1
fi

echo
echo "Workspace directories:"
printf "  %s\n" "$ROOT_DIR/keys" "$ROOT_DIR/output" "$ROOT_DIR/assets"

if [ -f .env ]; then
  echo "ok: .env present"
else
  echo "note: .env not found; copy .env.example to .env if you want local overrides"
fi

if [ "$missing" -ne 0 ]; then
  echo
  echo "One or more requirements are missing. See scripts/setup-env.sh for install commands."
  exit 1
fi

echo
echo "Environment looks ready."

