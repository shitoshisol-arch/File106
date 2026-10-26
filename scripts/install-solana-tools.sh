#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
ASSUME_YES=false

for arg in "$@"; do
  case "$arg" in
    --dry-run|--check)
      DRY_RUN=true
      ;;
    --yes|-y)
      ASSUME_YES=true
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: bash scripts/install-solana-tools.sh [--dry-run|--check] [--yes]"
      exit 1
      ;;
  esac
done

run() {
  printf '+ '
  printf '%q ' "$@"
  printf '\n'
  if [ "$DRY_RUN" = "false" ]; then
    "$@"
  fi
}

run_shell() {
  printf '+ %s\n' "$1"
  if [ "$DRY_RUN" = "false" ]; then
    bash -lc "$1"
  fi
}

confirm() {
  local prompt="$1"
  if [ "$ASSUME_YES" = "true" ]; then
    return 0
  fi

  read -r -p "$prompt [y/N] " answer
  case "$answer" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

load_paths() {
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
  if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck disable=SC1090
    source "$HOME/.cargo/env"
  fi
}

load_paths

echo "FILE106 Solana tooling installer"
echo "This installs missing CLIs only. It does not create wallets, mint tokens, or change Solana wallet config."
echo

if command -v solana >/dev/null 2>&1; then
  echo "ok: solana already installed at $(command -v solana)"
else
  echo "missing: solana CLI"
  echo "Official Anza installer command:"
  echo '  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"'
  if confirm "Install Solana CLI now?"; then
    run_shell 'sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"'
    load_paths
  else
    echo "Skipped Solana CLI install."
  fi
fi

if command -v cargo >/dev/null 2>&1; then
  echo "ok: cargo already installed at $(command -v cargo)"
else
  echo "missing: cargo/Rust"
  echo "Rust is required to install spl-token-cli from Cargo."
  echo "Official rustup command:"
  echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
  if confirm "Install Rust/Cargo now?"; then
    run_shell "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
    load_paths
  else
    echo "Skipped Rust/Cargo install."
  fi
fi

if ! command -v spl-token >/dev/null 2>&1; then
  if ! command -v cargo >/dev/null 2>&1; then
    echo "Cannot install spl-token because cargo is not available."
  else
    echo "missing: spl-token CLI"
    echo "Build dependencies may be required on Ubuntu."
    if confirm "Install common Ubuntu build dependencies with apt?"; then
      run sudo apt-get update
      run sudo apt-get install -y build-essential pkg-config libssl-dev libudev-dev
    fi

    if confirm "Install spl-token-cli with Cargo?"; then
      run cargo install spl-token-cli
      load_paths
    else
      echo "Skipped spl-token CLI install."
    fi
  fi
else
  echo "ok: spl-token already installed at $(command -v spl-token)"
fi

echo
echo "Version check:"
if command -v solana >/dev/null 2>&1; then
  solana --version
else
  echo "solana: not found"
fi

if command -v spl-token >/dev/null 2>&1; then
  spl-token --version
else
  echo "spl-token: not found"
fi

if command -v cargo >/dev/null 2>&1; then
  cargo --version
else
  echo "cargo: not found"
fi

echo
echo "Solana CLI config status:"
if command -v solana >/dev/null 2>&1; then
  solana config get || true
  echo
  echo "No wallet config was changed by this script."
  echo "This project uses OWNER_KEYPAIR=./keys/owner-file106.json explicitly in scripts."
else
  echo "solana is not installed, so config was not inspected."
fi

echo
echo "If solana was just installed and your shell cannot find it later, run:"
echo '  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"'
echo
echo "If cargo was just installed and your shell cannot find it later, run:"
echo '  source "$HOME/.cargo/env"'

