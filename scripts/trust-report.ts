import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  fetchMetadataFromSeeds,
  mplTokenMetadata,
} from '@metaplex-foundation/mpl-token-metadata';
import { publicKey } from '@metaplex-foundation/umi';
import { config as loadEnv } from 'dotenv';

loadEnv();

const DEFAULTS = {
  mint: 'Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE',
  owner: '56Jp1haLcYyWqh2MdezXv4BtecMJqRZujyApP85NyMRK',
  pool: 'HVpCVM92m6TkJpXpnudWEDZbjq5ucLJvJuJZAzSZhqtB',
  lpMint: '2isypyBvgEm3FmXDiSWfJRPM5ck8gW599mtAxXLv33kK',
  metadataUri: 'https://gateway.pinata.cloud/ipfs/bafkreiajxbrefzer2lqo5seg5wxne2kin7jbf2rzgp32gwxptsuxwmy45a',
  solMint: 'So11111111111111111111111111111111111111112',
} as const;

type Status = 'PASS' | 'WARN' | 'FAIL' | 'INFO';

interface Check {
  name: string;
  status: Status;
  detail: string;
}

interface FetchResult<T> {
  status: number;
  data?: T;
  error?: string;
}

interface RaydiumPoolInfo {
  type?: string;
  lpMint?: { address?: string };
  mintA?: { address?: string; symbol?: string };
  mintB?: { address?: string; symbol?: string };
  mintAmountA?: number | string;
  mintAmountB?: number | string;
  tvl?: number | string;
}

interface DexPair {
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
}

interface JupiterQuote {
  routePlan?: unknown[];
  outAmount?: string;
  priceImpactPct?: string;
}

const checks: Check[] = [];

function add(name: string, status: Status, detail: string): void {
  checks.push({ name, status, detail });
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

function clusterUrl(cluster: string): string {
  const configured = process.env.RPC_URL?.trim();
  if (configured) return configured;
  switch (cluster) {
    case 'mainnet-beta':
      return 'https://api.mainnet-beta.solana.com';
    case 'testnet':
      return 'https://api.testnet.solana.com';
    default:
      return 'https://api.devnet.solana.com';
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJson<T>(url: string, timeoutMs = 20000): Promise<FetchResult<T>> {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { status: response.status, error: `${response.status} ${response.statusText}` };
    }
    return { status: response.status, data: (await response.json()) as T };
  } catch (error) {
    return { status: 0, error: message(error) };
  }
}

function formatAmount(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-5)}` : address;
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const cluster = env('CLUSTER', process.env.SOLANA_CLUSTER || 'mainnet-beta');
  const rpcUrl = clusterUrl(cluster);
  const mintAddress = env('MINT_ADDRESS', DEFAULTS.mint);
  const ownerAddress = env('OWNER_ADDRESS', DEFAULTS.owner);
  const poolAddress = env('POOL_ADDRESS', DEFAULTS.pool);
  const lpMintAddress = env('LP_MINT', DEFAULTS.lpMint);
  const metadataUri = env('TOKEN_METADATA_URI', DEFAULTS.metadataUri);
  const generatedAt = new Date().toISOString();

  if (!asJson) {
    console.log('FILE106 trust report');
    console.log('====================');
    console.log(`Cluster:  ${cluster}`);
    console.log(`RPC:      ${rpcUrl}`);
    console.log(`Mint:     ${mintAddress}`);
    console.log(`Owner:    ${ownerAddress}`);
    console.log(`Pool:     ${poolAddress}`);
    console.log(`LP mint:  ${lpMintAddress}`);
    console.log(`Generated: ${generatedAt}`);
    console.log('');
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const mint = new PublicKey(mintAddress);

  try {
    const account = await connection.getAccountInfo(mint, 'confirmed');
    if (!account) {
      add('Mint account', 'FAIL', `No account found at ${mintAddress}`);
    } else {
      add(
        'Mint program',
        account.owner.equals(TOKEN_PROGRAM_ID) ? 'PASS' : 'FAIL',
        account.owner.toBase58(),
      );
    }

    const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_PROGRAM_ID);
    const expectedSupply = 106n * 10n ** 8n;
    add(
      'Fixed supply',
      mintInfo.supply === expectedSupply ? 'PASS' : 'FAIL',
      `${formatAmount(mintInfo.supply, mintInfo.decimals)} F106 (raw ${mintInfo.supply})`,
    );
    add('Decimals', mintInfo.decimals === 8 ? 'PASS' : 'FAIL', String(mintInfo.decimals));
    add(
      'Mint authority',
      mintInfo.mintAuthority === null ? 'PASS' : 'FAIL',
      mintInfo.mintAuthority?.toBase58() ?? 'none (revoked)',
    );
    add(
      'Freeze authority',
      mintInfo.freezeAuthority === null ? 'PASS' : 'FAIL',
      mintInfo.freezeAuthority?.toBase58() ?? 'none (revoked)',
    );

    const extensionCount = (mintInfo as unknown as { extensions?: unknown[] }).extensions?.length ?? 0;
    add(
      'Token extensions',
      extensionCount === 0 ? 'PASS' : 'FAIL',
      `${extensionCount} extension(s)`,
    );
  } catch (error) {
    add('Mint checks', 'FAIL', message(error));
  }

  try {
    const umi = createUmi(rpcUrl).use(mplTokenMetadata());
    const metadata = await fetchMetadataFromSeeds(umi, { mint: publicKey(mintAddress) });
    const name = metadata.name.replace(/\0/g, '').trim();
    const symbol = metadata.symbol.replace(/\0/g, '').trim();

    add(
      'Metadata mutable',
      metadata.isMutable ? 'FAIL' : 'PASS',
      metadata.isMutable ? 'isMutable=true' : 'isMutable=false (locked)',
    );
    add('Metadata name', name === 'FILE106' ? 'PASS' : 'WARN', name || '(empty)');
    add('Metadata symbol', symbol === 'F106' ? 'PASS' : 'WARN', symbol || '(empty)');
    add('Metadata URI', metadata.uri === metadataUri ? 'PASS' : 'INFO', metadata.uri);
    add('Metadata update authority', 'INFO', metadata.updateAuthority.toString());
  } catch (error) {
    add('Metadata checks', 'FAIL', message(error));
  }

  const metadataFetch = await fetchJson<{
    name?: string;
    symbol?: string;
    image?: string;
    description?: string;
  }>(metadataUri);

  if (metadataFetch.data) {
    add('Metadata JSON public', 'PASS', `HTTP ${metadataFetch.status}`);
    add(
      'JSON name/symbol',
      metadataFetch.data.name === 'FILE106' && metadataFetch.data.symbol === 'F106' ? 'PASS' : 'WARN',
      `${metadataFetch.data.name ?? '?'} / ${metadataFetch.data.symbol ?? '?'}`,
    );
    add(
      'JSON image',
      typeof metadataFetch.data.image === 'string' && metadataFetch.data.image.startsWith('https://')
        ? 'PASS'
        : 'WARN',
      metadataFetch.data.image ?? '(missing)',
    );
  } else {
    add('Metadata JSON public', 'FAIL', metadataFetch.error ?? `HTTP ${metadataFetch.status}`);
  }

  try {
    const lpMint = new PublicKey(lpMintAddress);
    const lpInfo = await getMint(connection, lpMint, 'confirmed', TOKEN_PROGRAM_ID);
    add(
      'LP mint supply',
      lpInfo.supply === 0n ? 'PASS' : 'FAIL',
      `${formatAmount(lpInfo.supply, lpInfo.decimals)} LP (0 means burned)`,
    );
  } catch (error) {
    add('LP mint supply', 'FAIL', message(error));
  }

  const raydium = await fetchJson<{ data?: RaydiumPoolInfo[] }>(
    `https://api-v3.raydium.io/pools/info/ids?ids=${encodeURIComponent(poolAddress)}`,
  );
  const pool = raydium.data?.data?.[0];
  if (pool) {
    add('Raydium pool', pool.type === 'Standard' ? 'PASS' : 'INFO', `type=${pool.type ?? 'unknown'}`);
    add(
      'Pool LP mint',
      pool.lpMint?.address === lpMintAddress ? 'PASS' : 'FAIL',
      pool.lpMint?.address ?? '(missing)',
    );
    add(
      'Pool reserves',
      'INFO',
      `${pool.mintAmountA ?? '?'} ${pool.mintA?.symbol ?? 'A'} / ${pool.mintAmountB ?? '?'} ${pool.mintB?.symbol ?? 'B'} · TVL ${pool.tvl ?? '?'}`,
    );
  } else {
    add('Raydium pool', 'WARN', raydium.error ?? 'No pool data returned');
  }

  const dex = await fetchJson<{ pairs?: DexPair[] }>(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mintAddress)}`,
  );
  const pairs = dex.data?.pairs ?? [];
  const pair = pairs.find((entry) => entry.pairAddress === poolAddress) ?? pairs[0];
  if (pair) {
    add(
      'DEX market',
      'PASS',
      `${pair.dexId ?? 'dex'} · ${shortAddress(pair.pairAddress ?? '')} · $${pair.liquidity?.usd ?? '?'} liquidity · $${pair.priceUsd ?? '?'} per F106`,
    );
  } else {
    add('DEX market', 'WARN', dex.error ?? 'No pair returned');
  }

  const jupiterToken = await fetchJson<{ isVerified?: boolean; symbol?: string }>(
    `https://lite-api.jup.ag/tokens/v1/token/${encodeURIComponent(mintAddress)}`,
  );
  if (jupiterToken.status === 200) {
    add(
      'Jupiter token list',
      'PASS',
      `listed${jupiterToken.data?.isVerified ? ' and verified' : ''}`,
    );
  } else {
    add(
      'Jupiter token list',
      'WARN',
      `${jupiterToken.status ? `HTTP ${jupiterToken.status}` : jupiterToken.error ?? 'error'} — not listed/verified yet`,
    );
  }

  const quote = await fetchJson<JupiterQuote>(
    `https://lite-api.jup.ag/swap/v1/quote?inputMint=${encodeURIComponent(mintAddress)}&outputMint=${encodeURIComponent(DEFAULTS.solMint)}&amount=1000000&slippageBps=100`,
  );
  if (quote.data?.routePlan && quote.data.routePlan.length > 0) {
    add(
      'Jupiter sell route',
      'PASS',
      `${quote.data.routePlan.length} route(s), out ${quote.data.outAmount ?? '?'} lamports`,
    );
  } else {
    add('Jupiter sell route', 'WARN', quote.error ?? 'No route returned');
  }

  const coingecko = await fetchJson<{ id?: string; name?: string }>(
    `https://api.coingecko.com/api/v3/coins/solana/contract/${encodeURIComponent(mintAddress)}`,
  );
  if (coingecko.status === 200) {
    add('CoinGecko listing', 'PASS', coingecko.data?.id ?? 'listed');
  } else {
    add(
      'CoinGecko listing',
      'WARN',
      `${coingecko.status ? `HTTP ${coingecko.status}` : coingecko.error ?? 'error'} — not listed`,
    );
  }

  try {
    const accounts = await connection.getParsedTokenAccountsByOwner(
      new PublicKey(ownerAddress),
      { mint },
      'confirmed',
    );
    let balance = 0;
    for (const item of accounts.value) {
      const parsed = item.account.data;
      if ('parsed' in parsed) {
        const amount = parsed.parsed?.info?.tokenAmount?.uiAmount;
        if (typeof amount === 'number') balance += amount;
      }
    }
    add('Owner token balance', 'INFO', `${balance} F106 · ${ownerAddress}`);
  } catch (error) {
    add('Owner token balance', 'WARN', `RPC limit or error: ${message(error)}`);
  }

  const summary = { pass: 0, warn: 0, info: 0, fail: 0 };
  for (const check of checks) {
    if (check.status === 'PASS') summary.pass += 1;
    else if (check.status === 'WARN') summary.warn += 1;
    else if (check.status === 'INFO') summary.info += 1;
    else summary.fail += 1;
  }

  const verdict =
    summary.fail === 0
      ? 'On-chain security checks passed. Remaining warnings are listing/visibility gaps, not contract permissions.'
      : 'One or more critical checks failed. Do not treat the token as hardened until resolved.';

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          cluster,
          rpcUrl,
          mint: mintAddress,
          owner: ownerAddress,
          pool: poolAddress,
          lpMint: lpMintAddress,
          metadataUri,
          generatedAt,
          checks,
          summary,
          verdict,
        },
        null,
        2,
      ),
    );
  } else {
    for (const check of checks) {
      console.log(`[${check.status}] ${check.name}: ${check.detail}`);
    }
    console.log('');
    console.log(`Summary: PASS ${summary.pass} · WARN ${summary.warn} · INFO ${summary.info} · FAIL ${summary.fail}`);
    console.log(verdict);
  }

  if (summary.fail > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(message(error));
  process.exit(1);
});
