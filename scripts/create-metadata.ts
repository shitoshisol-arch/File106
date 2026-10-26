import {
  TokenStandard,
  createV1,
  findMetadataPda,
  mplTokenMetadata,
} from '@metaplex-foundation/mpl-token-metadata';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import {
  keypairIdentity,
  percentAmount,
  publicKey,
} from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import bs58 from 'bs58';
import { config as loadEnv } from 'dotenv';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadEnv();

function env(name: string, fallback: string): string {
  return process.env[name] && process.env[name]!.trim() !== '' ? process.env[name]!.trim() : fallback;
}

function envAny(names: string[], fallback: string): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== '') return value.trim();
  }
  return fallback;
}

function clusterUrl(cluster: string): string {
  if (process.env.RPC_URL && process.env.RPC_URL.trim() !== '') return process.env.RPC_URL.trim();
  return cluster === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : cluster === 'testnet'
      ? 'https://api.testnet.solana.com'
      : 'https://api.devnet.solana.com';
}

function loadSecretKey(filePath: string): Uint8Array {
  if (!existsSync(filePath)) throw new Error(`Missing keypair file: ${filePath}`);
  return new Uint8Array(JSON.parse(readFileSync(filePath, 'utf8')) as number[]);
}

function signatureToBase58(result: { signature?: Uint8Array | string }): string {
  if (typeof result.signature === 'string') return result.signature;
  return result.signature ? bs58.encode(result.signature) : 'unknown';
}

async function main(): Promise<void> {
  const cluster = envAny(['CLUSTER', 'SOLANA_CLUSTER'], 'devnet');
  if (cluster === 'mainnet-beta' && envAny(['CONFIRM_MAINNET', 'ALLOW_MAINNET'], 'false') !== 'true') {
    throw new Error('Refusing mainnet-beta because CONFIRM_MAINNET is not true.');
  }

  const mint = env('MINT_ADDRESS', '');
  if (!mint) throw new Error('Set MINT_ADDRESS to add metadata to an existing mint.');

  const metadataUri = env('TOKEN_METADATA_URI', 'https://example.com/FILE106.json');
  if (cluster === 'mainnet-beta' && metadataUri.includes('example.com')) {
    throw new Error('Refusing mainnet-beta with example.com metadata URI. Upload metadata/logo first.');
  }

  const ownerKeypairPath = path.resolve(env('OWNER_KEYPAIR', './keys/owner-file106.json'));
  const umi = createUmi(clusterUrl(cluster)).use(mplTokenMetadata()).use(mplToolbox());
  const ownerKeypair = umi.eddsa.createKeypairFromSecretKey(loadSecretKey(ownerKeypairPath));
  umi.use(keypairIdentity(ownerKeypair));

  const mintPublicKey = publicKey(mint);
  const tx = await createV1(umi, {
    mint: mintPublicKey,
    authority: umi.identity,
    payer: umi.identity,
    updateAuthority: umi.identity,
    name: env('TOKEN_NAME', 'FILE106'),
    symbol: env('TOKEN_SYMBOL', 'F106'),
    uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(0),
    tokenStandard: TokenStandard.Fungible,
  }).sendAndConfirm(umi);

  const metadataPda = findMetadataPda(umi, { mint: mintPublicKey })[0].toString();
  const signature = signatureToBase58(tx);

  appendFileSync(
    'output/deployment-summary.md',
    [
      '',
      '## Standalone Metadata Transaction',
      '',
      `- Metadata PDA: ${metadataPda}`,
      `- Signature: ${signature}`,
      '',
    ].join('\n')
  );

  console.log(`Metadata PDA: ${metadataPda}`);
  console.log(`Signature: ${signature}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

