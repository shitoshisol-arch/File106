import {
  mplTokenMetadata,
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

function clusterUrl(cluster: string): string {
  switch (cluster) {
    case 'mainnet-beta': return 'https://api.mainnet-beta.solana.com';
    case 'testnet': return 'https://api.testnet.solana.com';
    default: return 'https://api.devnet.solana.com';
  }
}

function loadSecretKey(filePath: string): Uint8Array {
  if (!existsSync(filePath)) throw new Error(`Missing keypair file: ${filePath}`);
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`Keypair file must be a JSON array: ${filePath}`);
  return new Uint8Array(parsed as number[]);
}

const INCINERATOR = '1nc1nerator11111111111111111111111111111111';

async function main(): Promise<void> {
  const cluster = env('CLUSTER', 'devnet');
  const rpcUrl = clusterUrl(cluster);
  const ownerKeypairPath = path.resolve(env('OWNER_KEYPAIR', './keys/owner-file106.json'));
  const mintAddress = env('MINT_ADDRESS', '');
  if (!mintAddress) throw new Error('Set MINT_ADDRESS env var to the existing mint address.');

  const umi = createUmi(rpcUrl).use(mplTokenMetadata());
  const ownerKeypair = umi.eddsa.createKeypairFromSecretKey(loadSecretKey(ownerKeypairPath));
  umi.use(keypairIdentity(ownerKeypair));

  console.log('Current authority:', umi.identity.publicKey.toString());
  console.log('Renouncing metadata update authority ->', INCINERATOR);

  await updateV1(umi, {
    mint: publicKey(mintAddress),
    authority: umi.identity,
    newUpdateAuthority: publicKey(INCINERATOR),
  }).sendAndConfirm(umi);

  console.log('Done. Metadata update authority is now the incinerator.');
  console.log('Combined with isMutable=false, metadata is permanently sealed.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
