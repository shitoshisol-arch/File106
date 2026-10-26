#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p keys output assets

DRY_RUN=false
CHECK_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    --check)
      CHECK_ONLY=true
      DRY_RUN=true
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: bash scripts/create-token.sh [--dry-run|--check]"
      exit 1
      ;;
  esac
done

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

CLUSTER="${CLUSTER:-${SOLANA_CLUSTER:-devnet}}"
RPC_ARG="${RPC_URL:-$CLUSTER}"
OWNER_KEYPAIR="${OWNER_KEYPAIR:-./keys/owner-file106.json}"
MINT_KEYPAIR="${MINT_KEYPAIR:-./keys/mint-file106-token.json}"
REVOKE_AFTER_MINT="${REVOKE_AFTER_MINT:-false}"
TOKEN_SUPPLY="${TOKEN_SUPPLY:-106}"
TOKEN_DECIMALS="${TOKEN_DECIMALS:-8}"

if [ "$CLUSTER" = "mainnet-beta" ] && [ "${CONFIRM_MAINNET:-${ALLOW_MAINNET:-false}}" != "true" ]; then
  echo "Refusing mainnet-beta. Set CONFIRM_MAINNET=true only after devnet succeeds."
  exit 1
fi

if [ "$CLUSTER" = "mainnet-beta" ]; then
  echo "MAINNET WARNING: this will spend real SOL and create an irreversible token mint."
  echo "The script will continue only because CONFIRM_MAINNET=true is set."
fi

print_plan() {
  cat <<EOF
Planned commands:
  npx tsx scripts/create-token.ts
EOF

  if [ "$REVOKE_AFTER_MINT" = "true" ]; then
    cat <<EOF
  bash scripts/revoke-authorities.sh
EOF
  fi

  cat <<EOF

Effective config:
  CLUSTER=$CLUSTER
  RPC=$RPC_ARG
  OWNER_KEYPAIR=$OWNER_KEYPAIR
  MINT_KEYPAIR=$MINT_KEYPAIR
  TOKEN_NAME=${TOKEN_NAME:-FILE106}
  TOKEN_SYMBOL=${TOKEN_SYMBOL:-F106}
  TOKEN_SUPPLY=$TOKEN_SUPPLY
  TOKEN_DECIMALS=$TOKEN_DECIMALS
  TOKEN_METADATA_URI=${TOKEN_METADATA_URI:-https://example.com/FILE106.json}
EOF
}

print_plan

if [ "$TOKEN_SUPPLY" != "106" ]; then
  echo "Refusing to continue: TOKEN_SUPPLY must be 106."
  exit 1
fi

if [ "$TOKEN_DECIMALS" != "8" ]; then
  echo "Refusing to continue: TOKEN_DECIMALS must be 8."
  exit 1
fi

if [ "$DRY_RUN" = "true" ] && [ "$CHECK_ONLY" = "false" ]; then
  echo
  echo "Dry run only. No files were required and no on-chain transaction was sent."
  exit 0
fi

if [ ! -f "$OWNER_KEYPAIR" ]; then
  cat <<EOF
Missing owner wallet keypair: $OWNER_KEYPAIR

Create a devnet owner wallet with:
  mkdir -p keys
  solana-keygen new --outfile "$OWNER_KEYPAIR" --no-bip39-passphrase

Then fund it on devnet:
  solana airdrop 2 "\$(solana-keygen pubkey "$OWNER_KEYPAIR")" --url devnet
EOF
  exit 1
fi

if [ ! -f "$MINT_KEYPAIR" ]; then
  cat <<EOF
Missing mint keypair: $MINT_KEYPAIR

Generate one first. Example:
  npm run generate:mint -- --suffix "\${VANITY_SUFFIX:-FiLE}" --out "$MINT_KEYPAIR"
EOF
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Missing node_modules. Run: npm install"
  exit 1
fi

if [ "$DRY_RUN" = "true" ]; then
  echo
  echo "Dry run only. No on-chain transaction was sent."
  exit 0
fi

echo "About to create token metadata, initialize the mint, create the owner ATA, and mint exactly 106 tokens."
echo "Cluster: $CLUSTER"
echo "Owner:  $(solana-keygen pubkey "$OWNER_KEYPAIR")"
echo "Mint:   $(solana-keygen pubkey "$MINT_KEYPAIR")"
echo

npx tsx scripts/create-token.ts

if [ "$REVOKE_AFTER_MINT" = "true" ]; then
  echo
  echo "Revoking mint authority so the supply can never increase."
  echo "Attempting to revoke freeze authority as well; if no freeze authority exists, this is treated as already safe."
  bash scripts/revoke-authorities.sh
else
  echo "REVOKE_AFTER_MINT is not true. Authorities were left active for inspection."
  echo "After reviewing supply, decimals, and metadata, run: npm run revoke"
fi


