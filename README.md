# FILE106 Solana SPL Token Workspace

Devnet-first manual workspace for creating the FILE106 Solana SPL token:

- `name`: `FILE106`
- `symbol`: `F106`
- `supply`: exactly `106` whole coins
- `decimals`: `8`
- `chain`: Solana
- `logo`: `https://gateway.pinata.cloud/ipfs/bafybeicl5gjlcbpxmbdiomezfv5afnkedwmzk3dizouamrs7td7ltp6vuq`
- `owner keypair`: `./keys/owner-file106.json`
- `mint keypair`: `./keys/mint-file106-token.json`

No script hardcodes private keys. Keypair files live under `./keys/`, which is ignored by git.

## Vanity Suffix Reality Check

Solana public keys are base58 strings. Base58 allows:

```text
123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
```

It excludes `0`, `O`, `I`, and `l`. Because of that:

- `FILE106` is impossible because it contains `I` and `0`.
- `F106` is impossible because it contains `0`.
- `FiLE` is valid and is the chosen visual substitute for `FILE`.
- `F1o6` is valid if the client accepts lowercase letter `o` as a visual substitute for zero.
- `F16` is valid and much faster.

Vanity settings live in `.env`:

```bash
VANITY_SUFFIX=FiLE
MAX_VANITY_ATTEMPTS=2000000000
```

Expected attempts are roughly `58^N` for an `N` character suffix. A 4-character suffix averages about 11.3 million attempts.

## Metadata Model

Solana token metadata is usually represented by a Metaplex Token Metadata account. That account is a program-derived address linked to the mint. The on-chain metadata stores compact fields such as `name`, `symbol`, and a `uri`. The `uri` points to an off-chain JSON metadata file.

Required off-chain metadata fields for this project:

```json
{
  "name": "FILE106",
  "symbol": "F106",
  "description": "FILE106 is a fixed-supply Solana archive token: exactly 106 coins ever minted, 8 decimals. Classified. Decoded. Immutable.",
  "image": "https://gateway.pinata.cloud/ipfs/bafybeicl5gjlcbpxmbdiomezfv5afnkedwmzk3dizouamrs7td7ltp6vuq",
  "external_url": "https://gateway.pinata.cloud/ipfs/bafybeicl5gjlcbpxmbdiomezfv5afnkedwmzk3dizouamrs7td7ltp6vuq"
}
```

Two example files are included:

```bash
cat assets/metadata.json
cat assets/FILE106-metadata.json
```

`assets/metadata.json` is rewritten by `scripts/create-token.ts` from `.env`. `assets/FILE106-metadata.json` is the extended upload copy with attributes and `properties.files`.

Before mainnet, upload the extended JSON to permanent public storage such as IPFS, Arweave, NFT.Storage, Pinata, Bundlr, or Irys, then set:

```bash
TOKEN_METADATA_URI=https://your-permanent-metadata-json-url
```

The logo is pinned to IPFS at the CID above, but permanent storage for the metadata JSON is still required.

During token creation, `TOKEN_METADATA_URI` is linked to the mint by the Metaplex metadata transaction. Metadata can be updated later only by the metadata update authority. For a trust-minimized launch, the update authority should eventually be locked or renounced after the final image and metadata are verified.

## Ubuntu Tooling Install

The official Solana/Agave install command for Linux is:

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana --version
```

Rust/Cargo is required to install `spl-token-cli` if it is missing:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
cargo --version
```

Common Ubuntu build dependencies:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libssl-dev libudev-dev
```

Install SPL Token CLI:

```bash
cargo install spl-token-cli
spl-token --version
```

Or use the safe interactive project installer:

```bash
bash scripts/install-solana-tools.sh --dry-run
bash scripts/install-solana-tools.sh
```

The installer does not create wallets, mint tokens, or run `solana config set`. It prints the current Solana CLI config only so you can inspect it.

## Local Config

Create `.env`:

```bash
cp .env.example .env
```

Recommended devnet values:

```bash
CLUSTER=devnet
OWNER_KEYPAIR=./keys/owner-file106.json
MINT_KEYPAIR=./keys/mint-file106-token.json
TOKEN_NAME=FILE106
TOKEN_SYMBOL=F106
TOKEN_SUPPLY=106
TOKEN_DECIMALS=8
VANITY_SUFFIX=FiLE
MAX_VANITY_ATTEMPTS=2000000000
CONFIRM_MAINNET=false
```

Do not put private keys or seed phrases in `.env`.

## Project Setup

```bash
npm install
bash scripts/check-env.sh
```

`check-env.sh` should pass after `solana`, `spl-token`, Node, npm, and project dependencies are installed. It runs under Ubuntu/WSL and expects the Solana CLI inside that environment. On Windows, verify the Windows CLIs directly with `solana --version` and `spl-token --version`; the Node scripts do not require them.

## Devnet Owner Wallet

This creates the local fee payer and token owner wallet. It uses `./keys/owner-file106.json` explicitly:

```bash
mkdir -p keys
solana-keygen new --outfile ./keys/owner-file106.json --no-bip39-passphrase
solana airdrop 2 "$(solana-keygen pubkey ./keys/owner-file106.json)" --url devnet
solana balance "$(solana-keygen pubkey ./keys/owner-file106.json)" --url devnet
```

Keep `./keys/owner-file106.json` private.

## Vanity Mint Generation

Preferred suffix:

```bash
npm run generate:mint -- --suffix FiLE --out ./keys/mint-file106-token.json --max-attempts 2000000000
```

Faster fallback:

```bash
npm run generate:mint -- --suffix F16 --out ./keys/mint-file106-token.json --max-attempts 5000000
```

A 4-character suffix averages about 11.3 million attempts. The generator runs single-threaded, so expect several minutes for `FiLE`.

Invalid examples that the script will reject:

```bash
npm run generate:mint -- --suffix FILE106 --out ./keys/mint-file106-token.json
npm run generate:mint -- --suffix F106 --out ./keys/mint-file106-token.json
```

## Dry Run

Print the exact project commands and effective config without sending transactions:

```bash
bash scripts/create-token.sh --dry-run
bash scripts/revoke-authorities.sh --dry-run
```

## Devnet Token Creation

This creates the mint, creates Metaplex metadata, creates the owner associated token account, and mints exactly `106` whole tokens (`10,600,000,000` base units at 8 decimals):

```bash
npm run create:token
```

The guarded Ubuntu wrapper runs the same Node script after its dry-run and mainnet checks:

```bash
bash scripts/create-token.sh
```

Authorities are left active for inspection by default (`REVOKE_AFTER_MINT=false`). After reviewing the mint, supply, decimals, and metadata, revoke them explicitly:

```bash
npm run revoke
```

That permanently disables mint authority and attempts to disable freeze authority. Authority revocation is irreversible.

## Devnet Metadata Creation Only

Use this only if you created a mint separately and need to add metadata afterward:

```bash
MINT_ADDRESS=<existing-devnet-mint-address> npx tsx scripts/create-metadata.ts
```

The normal `bash scripts/create-token.sh` flow already creates metadata.

## Authority Revocation Only

If revocation did not run automatically, run:

```bash
npm run revoke
```

This uses `OWNER_KEYPAIR=./keys/owner-file106.json` explicitly and refuses mainnet unless `CONFIRM_MAINNET=true`. The Ubuntu CLI alternative is `bash scripts/revoke-authorities.sh` (`npm run revoke:bash`).

## Metadata Maintenance

Update the off-chain metadata URI while the update authority is still active:

```bash
MINT_ADDRESS=<mint-address> NEW_METADATA_URI=<new-json-uri> npx tsx scripts/update-metadata.ts
```

Lock metadata permanently (`isMutable` becomes false and cannot be changed back):

```bash
MINT_ADDRESS=<mint-address> npx tsx scripts/lock-metadata.ts
```

Renounce the metadata update authority to the incinerator address:

```bash
MINT_ADDRESS=<mint-address> npx tsx scripts/revoke-metadata-authority.ts
```

Both operations are irreversible. Run them only after the final metadata is verified.

## Final Verification

Set the mint address from your generated mint keypair:

```bash
MINT_ADDRESS="$(solana-keygen pubkey ./keys/mint-file106-token.json)"
OWNER_ADDRESS="$(solana-keygen pubkey ./keys/owner-file106.json)"
```

Inspect the mint:

```bash
spl-token --url devnet display "$MINT_ADDRESS"
spl-token --url devnet supply "$MINT_ADDRESS"
spl-token --url devnet accounts --owner "$OWNER_ADDRESS"
```

Or run the workspace status check:

```bash
npm run status
```

Inspect the Solana account and saved deployment files:

```bash
solana account "$MINT_ADDRESS" --url devnet
cat output/deployment-summary.md
cat output/deployment.json
```

Expected result:

- Supply is `106`.
- Decimals are `8`.
- Mint authority is disabled after the revoke step.
- Freeze authority is disabled or absent after the revoke step.
- Metadata URI points to your configured `TOKEN_METADATA_URI`.

## Trust Report and Public Site

Run the read-only trust report. It never loads a keypair, signs, or sends a transaction:

```bash
npm run trust:report
npm run trust:report -- --json
```

It verifies the mint program, fixed supply, decimals, revoked authorities, locked metadata, public metadata JSON, LP burn, Raydium pool, DEX market, Jupiter route, and Jupiter/CoinGecko listing status.

The static trust site is in `site/`. Preview it locally with `npx serve site`, then deploy that folder to any static host (Vercel, Netlify, or GitHub Pages). Replace the `[SITE_URL]` and social placeholders in `output/trust/jupiter-vrfd-submission.md` and `output/trust/coingecko-submission.md`. The site uses only public on-chain links and has no analytics or wallet connection.

## Windows Notes

The core flow is cross-platform Node and runs directly in PowerShell:

```powershell
npm run create:token
npm run revoke
npm run status
```

The `scripts/*.sh` wrappers are for Ubuntu or WSL with the Solana CLI installed inside that environment. They are not required for the Node flow. Shell scripts and env files are pinned to LF line endings in `.gitattributes`; if a script was edited on Windows, re-normalize it before running it under WSL.

Some Agave builds of `solana-keygen grind` fail to find longer suffixes on Windows. Use `npm run generate:mint` instead.

## Mainnet Guard

Mainnet is refused unless all of the following are true:

```bash
CLUSTER=mainnet-beta
CONFIRM_MAINNET=true
TOKEN_METADATA_URI=https://your-real-permanent-metadata.json
TOKEN_LOGO_URI=https://your-real-permanent-logo.png
```

Do not use mainnet until devnet succeeds end-to-end. Mainnet spends real SOL, and authority revocation is irreversible.
