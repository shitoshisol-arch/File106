// Generates the server's .env for the zero-cost deployment.
//
//   node scripts/archive/init-env.mjs --domain file106.duckdns.org
//   node scripts/archive/init-env.mjs --domain file106.duckdns.org \
//        --rpc "https://mainnet.helius-rpc.com/?api-key=..." \
//        --smtp "smtp://login@smtp-brevo.com:587" \
//        --mail-from archive@example.com
//
// Generated once, on the server, and never committed. Secret values are written
// to the file and deliberately never echoed: the point of this script is to
// remove the "generate it twice and paste it correctly" step, not to print
// secrets into a scrollback buffer.

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const TEMPLATE = join(root, '.env.example');

const CANONICAL_MINT = 'Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE';
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function usage(problem) {
  if (problem) console.error(`\n  error: ${problem}\n`);
  console.error(`  Usage:
    node scripts/archive/init-env.mjs --domain <host> [options]

  Required
    --domain <host>       public hostname, no scheme (e.g. file106.duckdns.org)

  Optional
    --rpc <url>           Solana RPC endpoint (default: public mainnet, rate-limited)
    --smtp <url>          SMTP URL; omit to log verification links instead of mailing
    --mail-from <addr>    sender address, required when --smtp is given
    --out <path>          write somewhere other than ./.env
    --force               overwrite an existing file

  Secrets (POSTGRES_PASSWORD, SESSION_SECRET, ANSWER_ENC_KEY) are generated here
  and never printed. Back up ANSWER_ENC_KEY off-server afterwards.
`);
  process.exit(problem ? 1 : 0);
}

const args = process.argv.slice(2);
const get = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? null : (args[index + 1] ?? '');
};
const has = (flag) => args.includes(flag);

if (has('--help') || has('-h')) usage();
if (!args.length) usage('no arguments');

const domain = get('--domain');
if (!domain) usage('--domain is required');
if (domain.includes('://') || domain.includes('/')) usage('--domain must be a bare host, no scheme or path');
if (!HOSTNAME.test(domain)) usage(`"${domain}" does not look like a hostname`);

const rpc = get('--rpc');
if (rpc) {
  if (!/^https:\/\//.test(rpc)) usage('--rpc must be an https:// URL');
  try {
    new URL(rpc);
  } catch {
    usage('--rpc is not a parseable URL');
  }
}

const smtp = get('--smtp');
if (smtp) {
  let parsed;
  try {
    parsed = new URL(smtp);
  } catch {
    usage('--smtp is not a parseable URL (percent-encode the password if it has @ or /)');
  }
  if (!/^smtps?:$/.test(parsed.protocol)) usage('--smtp must start with smtp:// or smtps://');
  if (!parsed.username || !parsed.password) usage('--smtp needs credentials: smtp://login:key@host:587');
}

const mailFrom = get('--mail-from');
if (smtp && !mailFrom) usage('--mail-from is required when --smtp is given (the address the provider verified)');
if (mailFrom && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mailFrom)) usage('--mail-from is not an email address');

const outPath = resolve(isAbsolute(get('--out') || '') ? get('--out') : join(root, get('--out') || '.env'));

if (existsSync(outPath) && !has('--force')) {
  console.error(`\n  ${outPath} already exists. Refusing to overwrite it.`);
  console.error('  Move it aside, or pass --force if you are certain it holds nothing you need.\n');
  process.exit(1);
}

// ---------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------
const postgresPassword = randomBytes(18).toString('base64url'); // 24 url-safe chars, nothing to quote
const sessionSecret = randomBytes(32).toString('hex');
const answerKey = randomBytes(32).toString('hex');

const siteOrigin = `https://${domain}`;

const values = {
  POSTGRES_PASSWORD: postgresPassword,
  DATABASE_URL: `postgres://file106:${postgresPassword}@127.0.0.1:5432/file106`,
  SITE_DOMAIN: domain,
  SITE_ORIGIN: siteOrigin,
  SESSION_SECRET: sessionSecret,
  ANSWER_ENC_KEY: answerKey,
  F106_MINT_ADDRESS: CANONICAL_MINT,
  F106_DECIMALS: '8',
  ALLOW_AUTOMATIC_PAYOUTS: 'false',
};

if (rpc) values.ARCHIVE_RPC_URL = rpc;
if (smtp) values.SMTP_URL = smtp;
if (mailFrom) values.MAIL_FROM = mailFrom;

// ---------------------------------------------------------------------
// Write, preserving the template's comments and untouched keys
// ---------------------------------------------------------------------
let text = readFileSync(TEMPLATE, 'utf8');
const applied = new Set();

text = text
  .split(/\r?\n/)
  .map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    if (!match || !(match[1] in values)) return line;
    applied.add(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  })
  .join('\n');

const missing = Object.keys(values).filter((key) => !applied.has(key));
if (missing.length) {
  text += `\n# --- written by init-env (not in the template) ------------------------\n`;
  for (const key of missing) text += `${key}=${values[key]}\n`;
}

writeFileSync(outPath, text, { mode: 0o600 });
try {
  chmodSync(outPath, 0o600);
} catch {
  // Windows has no meaningful file mode; the server does.
}

// ---------------------------------------------------------------------
// Self-check: never leave a half-written file behind silently
// ---------------------------------------------------------------------
const written = readFileSync(outPath, 'utf8');
const read = (key) => {
  const match = new RegExp(`^${key}=(.*)$`, 'm').exec(written);
  return match ? match[1].trim() : '';
};

const problems = [];
if (read('SESSION_SECRET').length !== 64) problems.push('SESSION_SECRET was not written');
if (!/^[0-9a-f]{64}$/.test(read('ANSWER_ENC_KEY'))) problems.push('ANSWER_ENC_KEY was not written');
if (!read('POSTGRES_PASSWORD')) problems.push('POSTGRES_PASSWORD was not written');
if (read('SITE_ORIGIN') !== siteOrigin) problems.push('SITE_ORIGIN does not match the domain');
if (!read('DATABASE_URL').includes(postgresPassword)) problems.push('DATABASE_URL does not carry the generated password');

if (problems.length) {
  for (const problem of problems) console.error(`  FAIL  ${problem}`);
  process.exit(1);
}

// ---------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------
const label = { POSTGRES_PASSWORD: 24, SESSION_SECRET: 64, ANSWER_ENC_KEY: 64 };
console.log(`\n  wrote ${outPath} (mode 600)\n`);
console.log(`  OK    POSTGRES_PASSWORD  generated, ${label.POSTGRES_PASSWORD} url-safe characters`);
console.log(`  OK    DATABASE_URL       points at 127.0.0.1:5432/file106`);
console.log(`  OK    SITE_DOMAIN        ${domain}`);
console.log(`  OK    SITE_ORIGIN        ${siteOrigin}`);
console.log(`  OK    SESSION_SECRET     generated, ${label.SESSION_SECRET} hex characters`);
console.log(`  OK    ANSWER_ENC_KEY     generated, ${label.ANSWER_ENC_KEY} hex characters`);

if (rpc) {
  console.log(`  OK    ARCHIVE_RPC_URL    ${new URL(rpc).host}`);
} else {
  console.warn('  WARN  ARCHIVE_RPC_URL    left at the public endpoint — rate-limited. Re-run with --rpc, or edit .env.');
}

if (smtp) {
  console.log(`  OK    SMTP_URL           ${new URL(smtp).host}`);
  console.log(`  OK    MAIL_FROM          ${mailFrom}`);
} else {
  console.warn('  WARN  SMTP_URL           not set — verification links go to the server log, not to users');
}

console.log(`
  Next, and not optional:

    1. Back up ANSWER_ENC_KEY somewhere off this server (password manager or
       paper). From Stage 4 it encrypts submitted answers; without it those
       submissions are permanently unreadable.
    2. node scripts/archive/preflight.mjs
    3. docker compose up -d --build
`);
