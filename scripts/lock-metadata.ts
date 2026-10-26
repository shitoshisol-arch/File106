import {
  mplTokenMetadata,
  fetchMetadataFromSeeds,
  updateV1,
} from '@metaplex-foundation/mpl-token-metadata';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadEnv();

function env(name: string, fallback: string): string {
  return process.env[name] && process.env[name]!.trim() !== '' ? process.env[name]!.trim() : fallback;
}

function loadSecretKey(filePath: string): Uint8Array {
  if (!existsSync(filePath)) throw new Error(`Missing keypair file: ${filePath}`);
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`Keypair file must be a JSON array: ${filePath}`);
  return new Uint8Array(parsed as number[]);
}

function clusterUrl(cluster: string): string {
  if (process.env.RPC_URL && process.env.RPC_URL.trim() !== '') return process.env.RPC_URL.trim();
  switch (cluster) {
    case 'mainnet-beta': return 'https://api.mainnet-beta.solana.com';
    case 'testnet': return 'https://api.testnet.solana.com';
    default: return 'https://api.devnet.solana.com';
  }
}

async function main(): Promise<void> {
  const cluster = env('CLUSTER', 'devnet');
  const rpcUrl = clusterUrl(cluster);
  const ownerKeypairPath = path.resolve(env('OWNER_KEYPAIR', './keys/owner-file106.json'));
  const mintAddress = env('MINT_ADDRESS', '');

  if (!mintAddress) throw new Error('Set MINT_ADDRESS env var to the existing mint address.');

  const umi = createUmi(rpcUrl).use(mplTokenMetadata());
  const ownerKeypair = umi.eddsa.createKeypairFromSecretKey(loadSecretKey(ownerKeypairPath));
  umi.use(keypairIdentity(ownerKeypair));

  const mintPk = publicKey(mintAddress);
  const currentMetadata = await fetchMetadataFromSeeds(umi, { mint: mintPk });

  console.log('Current isMutable:', currentMetadata.isMutable);
  console.log('Locking metadata permanently...');

  const result = await updateV1(umi, {
    mint: mintPk,
    authority: umi.identity,
    data: { ...currentMetadata },
    isMutable: false,
  }).sendAndConfirm(umi);

  console.log('Metadata locked. isMutable is now false — this cannot be undone.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
