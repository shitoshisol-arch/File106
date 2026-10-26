#!/usr/bin/env bash
set -euo pipefail

cat <<'EOF'
FILE106 Ubuntu setup commands
=============================

This script prints install commands. Review them first, then run the commands
you need. For an interactive installer, run:

   bash scripts/install-solana-tools.sh

1. Base packages
   sudo apt update
   sudo apt install -y curl build-essential pkg-config libssl-dev

2. Solana CLI / Agave toolchain
   sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
   export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
   solana --version

3. Rust, needed if you install spl-token from source
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source "$HOME/.cargo/env"

4. SPL Token CLI
   cargo install spl-token-cli
   spl-token --version

5. Node.js
   Use your preferred Node manager. Example with nvm:
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   source "$HOME/.nvm/nvm.sh"
   nvm install --lts
   node --version
   npm --version

6. Project dependencies
   npm install

7. Optional local config
   cp .env.example .env

8. Verify
   bash scripts/check-env.sh

Notes:
- Devnet is the default. Do not switch to mainnet-beta until devnet succeeds.
- Keep keypair JSON files under ./keys/. They are ignored by git.
- Do not put private keys or seed phrases in .env.
EOF

