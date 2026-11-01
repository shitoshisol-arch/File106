// Pre-deploy preflight.
//
// Run on the server (or locally to see what is still missing) before
// `docker compose up -d --build`:
//
//   node scripts/archive/preflight.mjs              # checks + live RPC/SMTP probe
//   node scripts/archive/preflight.mjs --no-network # offline: env checks only
//   node scripts/archive/preflight.mjs --env .env.staging
//
// It reads .env, never prints a secret value, and exits non-zero when anything
// would break the deploy. Process environment overrides .env, so the same file
// works inside the container.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotEnv } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));

const envFlag = process.argv.indexOf('--env');
const envArg = envFlag === -1 ? null : process.argv[envFlag + 1];
if (envFlag !== -1 && (!envArg || envArg.startsWith('--'))) {
  console.error('[preflight] --env needs a path');
  process.exit(2);
}
const envPath = envArg ? resolve(process.cwd(), envArg) : resolve(here, '..', '..', '.env');

let fileEnv = {};
let fileReadable = true;
try {
  fileEnv = parseDotEnv(readFileSync(envPath, 'utf8'));
} catch {
  fileReadable = false;
  console.warn(`[preflight] no readable .env at ${envPath} — checking process environment only`);
}

// A variable exported in the shell silently wins over the file, and one that is
// only in the shell makes an empty .env look configured. Name both, never the
// values.
const overridden = new Set();
const processOnly = new Set();
const env = (name) => {
  const fromProc = process.env[name];
  const fromFile = fileEnv[name];
  if (fromProc !== undefined && String(fromProc).trim() !== '') {
    if (fromFile === undefined) processOnly.add(name);
    else if (String(fromProc).trim() !== String(fromFile).trim()) overridden.add(name);
  }
  return String(fromProc ?? fromFile ?? '').trim();
};
const offline = process.argv.includes('--no-network');

// The one mint this project must never deviate from.
const CANONICAL_MINT = 'Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE';
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const results = [];
const record = (level, name, detail) => results.push({ level, name, detail });
const ok = (name, detail) => record('OK', name, detail);
const warn = (name, detail) => record('WARN', name, detail);
const fail = (name, detail) => record('FAIL', name, detail);

// Secrets are described by shape, never by value.
function describeSecret(value) {
  const hex = /^[0-9a-fA-F]+$/.test(value);
  return `${value.length} chars, ${hex ? 'hex' : 'not hex'}`;
}

const isPlaceholder = (value) => /change-me|changeme|example|your-|xxx|todo|placeholder/i.test(value);

// ---------------------------------------------------------------------
// Application secrets
// ---------------------------------------------------------------------
const sessionSecret = env('SESSION_SECRET');
if (!sessionSecret) {
  fail('SESSION_SECRET', 'missing — sessions cannot be signed (see docs/DEPLOY-ZERO-COST.md §5)');
} else if (isPlaceholder(sessionSecret)) {
  fail('SESSION_SECRET', 'still a placeholder value');
} else if (sessionSecret.length < 64) {
  warn('SESSION_SECRET', `${describeSecret(sessionSecret)} — 64 hex characters recommended`);
} else if (!/^[0-9a-fA-F]+$/.test(sessionSecret)) {
  warn('SESSION_SECRET', `${describeSecret(sessionSecret)} — a hex value avoids quoting surprises`);
} else {
  ok('SESSION_SECRET', '64 hex characters');
}

const answerKey = env('ANSWER_ENC_KEY');
if (!answerKey) {
  fail('ANSWER_ENC_KEY', 'missing — submitted answers cannot be encrypted or read back');
} else if (!/^[0-9a-fA-F]{64}$/.test(answerKey)) {
  fail('ANSWER_ENC_KEY', `${describeSecret(answerKey)} — must be exactly 64 hex characters`);
} else if (isPlaceholder(answerKey)) {
  fail('ANSWER_ENC_KEY', 'still a placeholder value');
} else {
  ok('ANSWER_ENC_KEY', '64 hex characters (back this up off-server before Stage 4)');
}

// ---------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------
const pgPassword = env('POSTGRES_PASSWORD');
if (!pgPassword) {
  fail('POSTGRES_PASSWORD', 'missing — docker compose refuses to start the database');
} else if (isPlaceholder(pgPassword)) {
  fail('POSTGRES_PASSWORD', 'still a placeholder value');
} else if (pgPassword.length < 20) {
  warn('POSTGRES_PASSWORD', `${pgPassword.length} chars — 24+ is better for a loopback-only database`);
} else {
  ok('POSTGRES_PASSWORD', `${pgPassword.length} chars`);
}

const databaseUrl = env('DATABASE_URL');
if (!databaseUrl) {
  warn('DATABASE_URL', 'not set — docker compose injects the db service URL itself');
} else {
  try {
    const url = new URL(databaseUrl);
    if (!/^postgres(ql)?:$/.test(url.protocol)) {
      fail('DATABASE_URL', `scheme ${url.protocol} is not postgres://`);
    } else if (!url.password) {
      fail('DATABASE_URL', 'no password in the connection string');
    } else {
      ok('DATABASE_URL', `${url.protocol}//${url.username}@${url.hostname}:${url.port || 5432}${url.pathname}`);
    }
  } catch {
    fail('DATABASE_URL', 'not a parseable URL');
  }
}

// ---------------------------------------------------------------------
// Public origin
// ---------------------------------------------------------------------
const siteDomain = env('SITE_DOMAIN');
const siteOrigin = env('SITE_ORIGIN');

if (!siteDomain) {
  fail('SITE_DOMAIN', 'missing — Caddy has no certificate to obtain');
} else if (isPlaceholder(siteDomain) || siteDomain === 'localhost') {
  fail('SITE_DOMAIN', 'still a placeholder');
} else if (siteDomain.includes('://') || siteDomain.includes('/')) {
  fail('SITE_DOMAIN', 'must be a bare host (no scheme, no path)');
} else {
  ok('SITE_DOMAIN', siteDomain);
}

if (!siteOrigin) {
  fail('SITE_ORIGIN', 'missing — the wallet message has no origin to name');
} else if (siteOrigin.endsWith('/')) {
  fail('SITE_ORIGIN', 'must not end with a slash');
} else if (!/^https:\/\//.test(siteOrigin) && !/^http:\/\/localhost/.test(siteOrigin)) {
  fail('SITE_ORIGIN', 'must be https:// in production');
} else if (siteDomain && siteOrigin !== `https://${siteDomain}`) {
  fail('SITE_ORIGIN', `must equal https://${siteDomain} — the wallet message embeds it verbatim`);
} else {
  ok('SITE_ORIGIN', siteOrigin);
}

if (siteDomain && /\.duckdns\.org$/i.test(siteDomain)) {
  warn('EMAIL DOMAIN', 'a DuckDNS name cannot hold SPF/DKIM records — expect friction with mail filters');
}

// ---------------------------------------------------------------------
// Solana configuration
// ---------------------------------------------------------------------
const mint = env('F106_MINT_ADDRESS');
if (!mint) {
  fail('F106_MINT_ADDRESS', 'missing — the balance gate has nothing to count');
} else if (!BASE58.test(mint)) {
  fail('F106_MINT_ADDRESS', 'not a base58 Solana address');
} else if (mint !== CANONICAL_MINT) {
  warn('F106_MINT_ADDRESS', `${mint} is not the advertised mint ${CANONICAL_MINT} — verify this is intentional`);
} else {
  ok('F106_MINT_ADDRESS', 'canonical F106 mint');
}

const decimals = env('F106_DECIMALS');
if (!decimals) {
  warn('F106_DECIMALS', 'not set — defaulting to 8');
} else if (decimals !== '8') {
  warn('F106_DECIMALS', `${decimals} — F106 has 8 decimals; amounts would be misreported`);
} else {
  ok('F106_DECIMALS', '8');
}

const rpcUrl = env('ARCHIVE_RPC_URL');
if (!rpcUrl) {
  warn('ARCHIVE_RPC_URL', 'not set — falling back to the public endpoint, which is rate-limited');
} else if (!/^https:\/\//.test(rpcUrl)) {
  fail('ARCHIVE_RPC_URL', 'must be https://');
} else if (/api\.mainnet-beta\.solana\.com/.test(rpcUrl)) {
  warn('ARCHIVE_RPC_URL', 'public endpoint: fine to smoke-test, will rate-limit under real traffic');
} else {
  ok('ARCHIVE_RPC_URL', new URL(rpcUrl).host);
}

const cluster = env('ARCHIVE_CLUSTER');
if (cluster && cluster !== 'mainnet-beta') {
  warn('ARCHIVE_CLUSTER', `${cluster} — production should read mainnet-beta`);
}

// ---------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------
const smtpUrl = env('SMTP_URL');
const mailFrom = env('MAIL_FROM');

if (!smtpUrl) {
  warn('SMTP_URL', 'not set — verification links go to the server log, not to the user');
} else {
  let smtpHost = null;
  try {
    const parsed = new URL(smtpUrl);
    smtpHost = parsed.host;
    if (!/^smtps?:$/.test(parsed.protocol)) fail('SMTP_URL', `scheme ${parsed.protocol} is not smtp:// or smtps://`);
    else if (!parsed.username || !parsed.password) warn('SMTP_URL', `${smtpHost} has no credentials in the URL`);
    else ok('SMTP_URL', `${parsed.protocol}//${parsed.username}@${smtpHost}`);
  } catch {
    fail('SMTP_URL', 'not a parseable URL (percent-encode the password if it has @ or /)');
  }

  if (!mailFrom) {
    fail('MAIL_FROM', 'required when SMTP_URL is set');
  } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mailFrom)) {
    fail('MAIL_FROM', 'not an email address');
  } else if (siteDomain && !mailFrom.toLowerCase().endsWith(`@${siteDomain.toLowerCase()}`)) {
    warn('MAIL_FROM', `${mailFrom} is not on ${siteDomain} — most providers require a verified sender`);
  } else {
    ok('MAIL_FROM', mailFrom);
  }
}

// ---------------------------------------------------------------------
// Safety switches
// ---------------------------------------------------------------------
const payouts = env('ALLOW_AUTOMATIC_PAYOUTS');
if (payouts.toLowerCase() === 'true') {
  fail('ALLOW_AUTOMATIC_PAYOUTS', 'must be false — the server never holds a treasury key');
} else {
  ok('ALLOW_AUTOMATIC_PAYOUTS', 'false (rewards stay manual)');
}

if (env('NODE_ENV') !== 'production') {
  warn('NODE_ENV', `"${env('NODE_ENV') || 'unset'}" — the image sets production itself; expect throwaway secrets outside it`);
}

// ---------------------------------------------------------------------
// Live probes
// ---------------------------------------------------------------------
async function probeRpc(url) {
  const body = { jsonrpc: '2.0', id: 1, method: 'getSlot', params: [{ commitment: 'confirmed' }] };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (payload?.error) throw new Error(payload.error.message || 'JSON-RPC error');
  if (typeof payload?.result !== 'number') throw new Error('unexpected response shape');
  return payload.result;
}

async function probeSmtp(url) {
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport(url);
  try {
    await transport.verify();
  } finally {
    transport.close?.();
  }
}

if (offline) {
  warn('NETWORK', 'probes skipped (--no-network)');
} else {
  if (rpcUrl) {
    const started = Date.now();
    try {
      const slot = await probeRpc(rpcUrl);
      ok('RPC probe', `slot ${slot} in ${Date.now() - started} ms`);
    } catch (error) {
      fail('RPC probe', error.message);
    }
  }

  if (smtpUrl) {
    try {
      await probeSmtp(smtpUrl);
      ok('SMTP probe', 'authenticated and ready to send');
    } catch (error) {
      fail('SMTP probe', error.message);
    }
  }
}

// ---------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------
if (fileReadable && (overridden.size > 0 || processOnly.size > 0)) {
  console.log('\n  These come from the shell, not the file — unset them to test the file alone:');
  for (const name of [...overridden].sort()) console.log(`    ${name.padEnd(22)} overrides ${envPath}`);
  for (const name of [...processOnly].sort()) console.log(`    ${name.padEnd(22)} absent from the file`);
  console.log('  PowerShell: Remove-Item Env:NAME   bash: unset NAME');
}

const order = { FAIL: 0, WARN: 1, OK: 2 };
results.sort((a, b) => order[a.level] - order[b.level] || a.name.localeCompare(b.name));

const width = Math.max(...results.map((r) => r.name.length));
for (const { level, name, detail } of results) {
  console.log(`  ${level.padEnd(4)}  ${name.padEnd(width)}  ${detail}`);
}

const counts = results.reduce((acc, r) => ({ ...acc, [r.level]: (acc[r.level] ?? 0) + 1 }), {});
const failures = counts.FAIL ?? 0;

console.log(
  `\n  ${counts.OK ?? 0} ok, ${counts.WARN ?? 0} warnings, ${failures} failure(s)`
);

if (failures > 0) {
  console.log('\n  Fix the failures above, then run this again before deploying.');
  process.exitCode = 1;
} else {
  console.log('\n  Ready: docker compose up -d --build');
}
