import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  AuthorityType,
  TOKEN_PROGRAM_ID,
  getMint,
  setAuthority,
} from '@solana/spl-token';
import { config as loadEnv } from 'dotenv';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadEnv();

function env(name: string, fallback: string): string {
  return process.env[name] && process.env[name]!.trim() !== '' ? process.env[name]!.trim() : fallback;
}

function clusterUrl(cluster: string): string {
  if (process.env.RPC_URL && process.env.RPC_URL.trim() !== '') return process.env.RPC_URL.trim();
  switch (cluster) {
    case 'mainnet-beta':
      return 'https://api.mainnet-beta.solana.com';
    case 'testnet':
      return 'https://api.testnet.solana.com';
    default:
      return 'https://api.devnet.solana.com';
  }
}

function loadSecretKey(filePath: string): Uint8Array {
  if (!existsSync(filePath)) throw new Error(`Missing keypair file: ${filePath}`);
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`Keypair file must be a JSON array: ${filePath}`);
  return new Uint8Array(parsed as number[]);
}

async function main(): Promise<void> {
  const cluster = env('CLUSTER', 'devnet');
  if (cluster === 'mainnet-beta' && env('CONFIRM_MAINNET', 'false') !== 'true') {
    throw new Error('Refusing mainnet-beta because CONFIRM_MAINNET is not true.');
  }

  const ownerKeypairPath = path.resolve(env('OWNER_KEYPAIR', './keys/owner-file106.json'));
  const owner = Keypair.fromSecretKey(loadSecretKey(ownerKeypairPath));

  let mintAddress = env('MINT_ADDRESS', '');
  if (!mintAddress) {
    const mintKeypairPath = path.resolve(env('MINT_KEYPAIR', './keys/mint-file106-token.json'));
    if (!existsSync(mintKeypairPath)) {
      throw new Error('Set MINT_ADDRESS or provide MINT_KEYPAIR.');
    }
    mintAddress = Keypair.fromSecretKey(loadSecretKey(mintKeypairPath)).publicKey.toBase58();
  }

  const connection = new Connection(clusterUrl(cluster), 'confirmed');
  const mint = new PublicKey(mintAddress);
  const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_PROGRAM_ID);

  console.log(`Cluster: ${cluster}`);
  console.log(`Mint:    ${mintAddress}`);
  console.log(`Owner:   ${owner.publicKey.toBase58()}`);
  console.log('');

  let mintSignature = 'already-disabled';
  if (!mintInfo.mintAuthority) {
    console.log('Mint authority is already disabled.');
  } else if (!mintInfo.mintAuthority.equals(owner.publicKey)) {
    throw new Error(`Owner is not the mint authority (${mintInfo.mintAuthority.toBase58()}).`);
  } else {
    mintSignature = await setAuthority(
      connection,
      owner,
      mint,
      owner.publicKey,
      AuthorityType.MintTokens,
      null,
      [],
      undefined,
      TOKEN_PROGRAM_ID,
    );
    console.log(`Mint authority disabled: ${mintSignature}`);
  }

  let freezeSignature = 'already-disabled';
  if (!mintInfo.freezeAuthority) {
    console.log('Freeze authority is already disabled or absent.');
  } else if (!mintInfo.freezeAuthority.equals(owner.publicKey)) {
    throw new Error(`Owner is not the freeze authority (${mintInfo.freezeAuthority.toBase58()}).`);
  } else {
    freezeSignature = await setAuthority(
      connection,
      owner,
      mint,
      owner.publicKey,
      AuthorityType.FreezeAccount,
      null,
      [],
      undefined,
      TOKEN_PROGRAM_ID,
    );
    console.log(`Freeze authority disabled: ${freezeSignature}`);
  }

  mkdirSync('output', { recursive: true });
  appendFileSync(
    'output/deployment-summary.md',
    [
      '',
      '## Authority Revocation',
      '',
      `Run at: ${new Date().toISOString()}`,
      `- Cluster: ${cluster}`,
      `- Mint: ${mintAddress}`,
      `- Mint authority signature: ${mintSignature}`,
      `- Freeze authority signature: ${freezeSignature}`,
      '',
    ].join('\n'),
  );

  console.log('');
  console.log('Authority revocation finished. Results appended to output/deployment-summary.md');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
