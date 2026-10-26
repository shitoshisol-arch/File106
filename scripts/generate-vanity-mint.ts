import { Keypair } from '@solana/web3.js';
import { config as loadEnv } from 'dotenv';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

loadEnv();

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

type Args = {
  suffix: string;
  out: string;
  maxAttempts: number;
  force: boolean;
};

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseArgs(): Args {
  const suffix = argValue('--suffix') ?? process.env.VANITY_SUFFIX ?? 'FiLE';
  const out = argValue('--out') ?? process.env.MINT_KEYPAIR ?? './keys/mint-file106-token.json';
  const maxAttemptsRaw =
    argValue('--max-attempts') ??
    process.env.MAX_VANITY_ATTEMPTS ??
    process.env.VANITY_MAX_ATTEMPTS ??
    '5000000';
  const maxAttempts = Number.parseInt(maxAttemptsRaw, 10);

  if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
    throw new Error(`Invalid max attempts: ${maxAttemptsRaw}`);
  }

  return {
    suffix,
    out,
    maxAttempts,
    force: process.argv.includes('--force'),
  };
}

function validateSuffix(suffix: string): void {
  if (!suffix) return;

  const invalid = [...suffix].filter((char) => !BASE58_ALPHABET.includes(char));
  if (invalid.length > 0) {
    throw new Error(
      [
        `Vanity suffix "${suffix}" is impossible for a Solana address.`,
        `Invalid base58 character(s): ${[...new Set(invalid)].join(', ')}`,
        'Solana/base58 excludes 0, O, I, and l, so literal FILE106 and F106 are impossible.',
        'Try a valid suffix such as "FiLE", "F1o6", or "F16".',
      ].join('\n')
    );
  }
}

function rateMessage(attempts: number, startedAt: number): string {
  const seconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  const rate = Math.round(attempts / seconds);
  return `${attempts.toLocaleString()} attempts (${rate.toLocaleString()}/sec)`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  validateSuffix(args.suffix);

  const outPath = path.resolve(args.out);
  if (existsSync(outPath) && !args.force) {
    throw new Error(`${outPath} already exists. Use --force only if you intentionally want to replace it.`);
  }

  mkdirSync(path.dirname(outPath), { recursive: true });

  console.log(`Searching for mint public key ending with "${args.suffix || '(no suffix)'}"...`);
  console.log(`Output keypair: ${outPath}`);
  console.log(`Max attempts: ${args.maxAttempts.toLocaleString()}`);

  const startedAt = Date.now();
  for (let attempt = 1; attempt <= args.maxAttempts; attempt += 1) {
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toBase58();

    if (!args.suffix || publicKey.endsWith(args.suffix)) {
      writeFileSync(outPath, JSON.stringify(Array.from(keypair.secretKey)));
      chmodSync(outPath, 0o600);
      console.log(`Found mint: ${publicKey}`);
      console.log(`Saved keypair with 0600 permissions.`);
      console.log(`Attempts: ${attempt.toLocaleString()}`);
      return;
    }

    if (attempt % 100000 === 0) {
      console.log(`Still searching: ${rateMessage(attempt, startedAt)}`);
    }
  }

  throw new Error(
    [
      `No match found after ${args.maxAttempts.toLocaleString()} attempts.`,
      'Use a shorter valid suffix or increase MAX_VANITY_ATTEMPTS.',
      'Expected attempts are roughly 58^N for an N-character suffix.',
    ].join('\n')
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});


