#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run|--check)
      DRY_RUN=true
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: bash scripts/revoke-authorities.sh [--dry-run|--check]"
      exit 1
      ;;
  esac
done

CLUSTER="${CLUSTER:-${SOLANA_CLUSTER:-devnet}}"
RPC_ARG="${RPC_URL:-$CLUSTER}"
OWNER_KEYPAIR="${OWNER_KEYPAIR:-./keys/owner-file106.json}"
MINT_KEYPAIR="${MINT_KEYPAIR:-./keys/mint-file106-token.json}"

if [ "$CLUSTER" = "mainnet-beta" ] && [ "${CONFIRM_MAINNET:-${ALLOW_MAINNET:-false}}" != "true" ]; then
  echo "Refusing mainnet-beta. Set CONFIRM_MAINNET=true only after devnet succeeds."
  exit 1
fi

if [ ! -f "$OWNER_KEYPAIR" ]; then
  echo "Missing owner keypair: $OWNER_KEYPAIR"
  exit 1
fi

if [ -n "${MINT_ADDRESS:-}" ]; then
  MINT="$MINT_ADDRESS"
elif [ -f "$MINT_KEYPAIR" ]; then
  MINT="$(solana-keygen pubkey "$MINT_KEYPAIR")"
else
  echo "Set MINT_ADDRESS or provide MINT_KEYPAIR."
  exit 1
fi

cat <<EOF
Planned authority revoke commands:
  spl-token --url "$RPC_ARG" --owner "$OWNER_KEYPAIR" --fee-payer "$OWNER_KEYPAIR" authorize "$MINT" mint --disable
  spl-token --url "$RPC_ARG" --owner "$OWNER_KEYPAIR" --fee-payer "$OWNER_KEYPAIR" authorize "$MINT" freeze --disable
EOF

if [ "$DRY_RUN" = "true" ]; then
  echo
  echo "Dry run only. No authority changes were sent."
  exit 0
fi

mkdir -p output

run_authorize() {
  local authority="$1"
  local label="$2"
  local log_file="output/revoke-${authority}.log"

  echo "Disabling ${label} authority for mint ${MINT}..."
  set +e
  spl-token --url "$RPC_ARG" --owner "$OWNER_KEYPAIR" --fee-payer "$OWNER_KEYPAIR" authorize "$MINT" "$authority" --disable 2>&1 | tee "$log_file"
  local status=${PIPESTATUS[0]}
  set -e

  local signature
  signature="$(awk '/Signature:/ {print $2}' "$log_file" | tail -n 1)"

  if [ "$status" -eq 0 ]; then
    echo "- ${label} authority revoke signature: ${signature:-unknown}" >> output/deployment-summary.md
    printf '{"authority":"%s","status":"revoked","signature":"%s"}\n' "$authority" "${signature:-unknown}" > "output/revoke-${authority}.json"
  else
    echo "- ${label} authority revoke: command returned non-zero; it may already be disabled or absent. See ${log_file}" >> output/deployment-summary.md
    printf '{"authority":"%s","status":"not-revoked-or-already-disabled","log":"%s"}\n' "$authority" "$log_file" > "output/revoke-${authority}.json"
  fi
}

{
  echo
  echo "## Authority Revocation"
  echo
  echo "Run at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "- Mint: ${MINT}"
} >> output/deployment-summary.md

run_authorize mint "mint"
run_authorize freeze "freeze"

echo
echo "Authority revoke results appended to output/deployment-summary.md"


