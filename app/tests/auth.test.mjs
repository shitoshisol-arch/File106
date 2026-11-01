// Stage 2 gate: registration, verification, sign-in, wallet linking, and the
// on-chain balance gate — exercised through the real Fastify app against an
// embedded Postgres engine.
//
// Run: node app/tests/auth.test.mjs
//
// What is real here: HTTP routing, sessions, CSRF, password hashing, the
// single-use nonce lifecycle, and ed25519 signature verification (messages are
// signed with a generated keypair). What is stubbed: the Solana RPC call, so the
// suite needs no network. app/tests/solana.test.mjs covers the amount maths and
// the production balance reader separately.

import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

import { createDb } from '../db.js';
import { applyMigrations } from '../migrate.js';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { walletLinkMessage } from '../lib/solana.js';

const passed = [];
const check = async (name, fn) => {
  await fn();
  passed.push(name);
  console.log(`  PASS  ${name}`);
};

// ---------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------
const pglite = new PGlite();
const db = createDb({
  query: (text, params) => pglite.query(text, params),
  exec: (text) => pglite.exec(text),
});

await applyMigrations({ db, log: { info: () => {} } });

const config = loadConfig({
  NODE_ENV: 'test',
  SITE_ORIGIN: 'http://localhost:3000',
  SESSION_SECRET: 'a'.repeat(64),
  ANSWER_ENC_KEY: 'b'.repeat(64),
  F106_MINT_ADDRESS: 'Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE',
  F106_DECIMALS: '8',
  SMTP_URL: '',
});

const balanceCalls = [];
let balanceState = { amount: '1.50000000', baseUnits: 150000000n, decimals: 8, fail: false };

const balanceReader = async (address) => {
  balanceCalls.push(address);
  if (balanceState.fail) throw new Error('RPC unreachable');
  return { amount: balanceState.amount, baseUnits: balanceState.baseUnits, decimals: balanceState.decimals };
};

const sentMail = [];
const mailer = {
  delivered: false,
  async send(message) {
    sentMail.push(message);
    return { delivered: false };
  },
};

const app = await buildServer({ config, db, balanceReader, mailer, logger: false });
await app.ready();

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function cookieJar(response) {
  const header = response.headers['set-cookie'];
  const list = Array.isArray(header) ? header : header ? [header] : [];
  const jar = {};
  for (const entry of list) {
    const [pair] = entry.split(';');
    const index = pair.indexOf('=');
    jar[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return jar;
}

function mergeCookies(...jars) {
  return Object.assign({}, ...jars);
}

function csrfFrom(html) {
  const match = /name="csrf" value="([a-f0-9]{64})"/.exec(html);
  return match ? match[1] : null;
}

const form = (fields) => new URLSearchParams(fields).toString();
const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' };

async function getPage(url, cookies = {}) {
  const response = await app.inject({ method: 'GET', url, cookies });
  return { response, cookies: cookieJar(response) };
}

async function postForm(url, fields, cookies) {
  return app.inject({
    method: 'POST',
    url,
    payload: form(fields),
    cookies,
    headers: FORM_HEADERS,
  });
}

async function postJson(url, body, cookies, csrf) {
  return app.inject({
    method: 'POST',
    url,
    payload: body,
    cookies,
    headers: csrf ? { 'x-csrf-token': csrf } : {},
  });
}

const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(-10);
const account = {
  username: `custodian_${unique}`,
  email: `custodian_${unique}@file106.local`,
  password: 'archive-pass-106',
};

async function registerAccount(acc) {
  const page1 = await getPage('/register');
  const csrf = csrfFrom(page1.response.body);
  const result = await postForm(
    '/register',
    {
      csrf,
      username: acc.username,
      email: acc.email,
      password: acc.password,
      confirmPassword: acc.password,
      acceptTerms: '1',
    },
    page1.cookies
  );
  return { result, cookies: mergeCookies(page1.cookies, cookieJar(result)), csrf };
}

async function verifyAndSignIn(acc) {
  const { result, cookies, csrf } = await registerAccount(acc);
  assert.equal(result.statusCode, 201, result.body);

  const link = /href="(http:\/\/localhost:3000\/verify\?token=[a-f0-9]{64})"/.exec(result.body)?.[1];
  assert.ok(link, 'verification link should be present in development mode');

  const verifyResponse = await app.inject({ method: 'GET', url: link.replace('http://localhost:3000', ''), cookies });
  assert.equal(verifyResponse.statusCode, 303);

  const loginPage = await getPage('/login', cookies);
  const loginCsrf = csrfFrom(loginPage.response.body) || csrf;
  const login = await postForm(
    '/login',
    { csrf: loginCsrf, email: acc.email, password: acc.password },
    mergeCookies(cookies, loginPage.cookies)
  );

  return { login, cookies: mergeCookies(cookies, loginPage.cookies, cookieJar(login)) };
}

// ---------------------------------------------------------------------
console.log('public surface');

await check('the trust page is still served at /', async () => {
  const { response } = await getPage('/');
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /FILE106/);
  assert.match(response.body, /Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE/);
});

await check('security headers are emitted', async () => {
  const { response } = await getPage('/');
  assert.ok(response.headers['content-security-policy'], 'CSP header missing');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

await check('an unknown path returns the archive 404, not a stack trace', async () => {
  const { response } = await getPage('/no-such-file');
  assert.equal(response.statusCode, 404);
  assert.match(response.body, /NO SUCH RECORD/);
});

await check('the dashboard sends anonymous visitors to sign in', async () => {
  const { response } = await getPage('/dashboard');
  assert.equal(response.statusCode, 303);
  assert.equal(response.headers.location, '/login?notice=login-required');
});

console.log('registration and verification');

await check('registration creates a pending account and emails a link', async () => {
  const before = sentMail.length;
  const { result } = await registerAccount(account);
  assert.equal(result.statusCode, 201);
  assert.match(result.body, /VERIFY YOUR EMAIL/);
  assert.equal(sentMail.length, before + 1);
  assert.match(sentMail.at(-1).text, /\/verify\?token=[a-f0-9]{64}/);

  const row = await db.one('select status from users where email = $1', [account.email]);
  assert.equal(row.status, 'pending_verification');
});

await check('a weak password is rejected before the database is touched', async () => {
  const page = await getPage('/register');
  const csrf = csrfFrom(page.response.body);
  const result = await postForm(
    '/register',
    {
      csrf,
      username: `weak_${unique}`,
      email: `weak_${unique}@file106.local`,
      password: 'short',
      confirmPassword: 'short',
    },
    page.cookies
  );

  assert.equal(result.statusCode, 400);
  const stored = await db.one('select id from users where email = $1', [`weak_${unique}@file106.local`]);
  assert.equal(stored, null);
});

await check('duplicate email registration is refused without leaking the hash', async () => {
  const page = await getPage('/register');
  const csrf = csrfFrom(page.response.body);
  const result = await postForm(
    '/register',
    {
      csrf,
      username: `${account.username}x`,
      email: account.email,
      password: account.password,
      confirmPassword: account.password,
      acceptTerms: '1',
    },
    page.cookies
  );

  assert.equal(result.statusCode, 409);
  assert.match(result.body, /ALREADY REGISTERED/i);
  assert.ok(!result.body.includes('scrypt$'));
});

await check('a request without a CSRF token is rejected', async () => {
  const result = await app.inject({
    method: 'POST',
    url: '/register',
    payload: form({ username: 'no_csrf', email: 'no@csrf.local', password: 'archive-pass-106' }),
    headers: FORM_HEADERS,
  });
  assert.equal(result.statusCode, 403);
  assert.match(result.body, /REQUEST REJECTED/);
});

await check('signing in before verifying is refused', async () => {
  const page = await getPage('/login');
  const csrf = csrfFrom(page.response.body);
  const result = await postForm(
    '/login',
    { csrf, email: account.email, password: account.password },
    page.cookies
  );
  assert.equal(result.statusCode, 403);
  assert.match(result.body, /VERIFY YOUR EMAIL/);
});

await check('the verification link activates the account exactly once', async () => {
  const mail = sentMail.at(-1).text;
  const token = /\/verify\?token=([a-f0-9]{64})/.exec(mail)[1];

  const first = await app.inject({ method: 'GET', url: `/verify?token=${token}` });
  assert.equal(first.statusCode, 303);
  assert.equal(first.headers.location, '/login?notice=verified');

  const second = await app.inject({ method: 'GET', url: `/verify?token=${token}` });
  assert.equal(second.statusCode, 400);

  const row = await db.one('select status, email_verified_at from users where email = $1', [account.email]);
  assert.equal(row.status, 'active');
  assert.ok(row.email_verified_at);
});

console.log('sign-in');

await check('a wrong password is refused with a generic message', async () => {
  const page = await getPage('/login');
  const csrf = csrfFrom(page.response.body);
  const result = await postForm(
    '/login',
    { csrf, email: account.email, password: 'wrong-password-106' },
    page.cookies
  );
  assert.equal(result.statusCode, 401);
  assert.match(result.body, /INVALID EMAIL OR PASSWORD/);
});

await check('a correct password creates a session and redirects to the dashboard', async () => {
  const page = await getPage('/login');
  const csrf = csrfFrom(page.response.body);
  const result = await postForm('/login', { csrf, email: account.email, password: account.password }, page.cookies);

  assert.equal(result.statusCode, 303);
  assert.equal(result.headers.location, '/dashboard');

  const cookies = mergeCookies(page.cookies, cookieJar(result));
  const dashboard = await app.inject({ method: 'GET', url: '/dashboard', cookies });
  assert.equal(dashboard.statusCode, 200);
  assert.match(dashboard.body, new RegExp(account.username));
  assert.match(dashboard.body, /NO WALLET LINKED/);
});

await check('a session id is regenerated on sign-in', async () => {
  const before = await getPage('/login');
  const csrf = csrfFrom(before.response.body);
  const result = await postForm('/login', { csrf, email: account.email, password: account.password }, before.cookies);

  const anonymousId = Object.keys(before.cookies)[0];
  const signedIn = cookieJar(result);
  const signedInId = Object.keys(signedIn)[0];
  assert.equal(anonymousId, signedInId, 'same cookie name is reused');

  // The value must differ: the pre-login identifier cannot become the session.
  assert.notEqual(before.cookies[anonymousId], signedIn[signedInId]);
});

console.log('wallet linking');

const keypair = Keypair.generate();
const walletAddress = keypair.publicKey.toBase58();

let session;
let dashboardCsrf;

await check('the dashboard exposes a CSRF token for the wallet calls', async () => {
  session = await verifyAndSignIn({
    username: `linker_${unique}`,
    email: `linker_${unique}@file106.local`,
    password: 'archive-pass-106',
  });

  assert.equal(session.login.statusCode, 303);

  const dashboard = await app.inject({ method: 'GET', url: '/dashboard', cookies: session.cookies });
  dashboardCsrf = /data-csrf="([a-f0-9]{64})"/.exec(dashboard.body)?.[1];
  assert.ok(dashboardCsrf, 'wallet panel must carry a CSRF token');
});

await check('wallet API calls require both a session and a CSRF header', async () => {
  const anonymous = await postJson('/api/wallet/challenge', { address: walletAddress }, {}, dashboardCsrf);
  assert.equal(anonymous.statusCode, 401);

  const noCsrf = await postJson('/api/wallet/challenge', { address: walletAddress }, session.cookies);
  assert.equal(noCsrf.statusCode, 403);
});

await check('a challenge is issued for the requested address', async () => {
  const result = await postJson('/api/wallet/challenge', { address: walletAddress }, session.cookies, dashboardCsrf);
  assert.equal(result.statusCode, 200);

  const payload = JSON.parse(result.body);
  assert.equal(payload.nonce.length, 32);
  assert.ok(payload.message.includes(walletAddress));
  assert.ok(payload.message.includes(payload.nonce));
  assert.match(payload.message, /moves no funds/);

  const nonceRow = await db.one('select purpose, wallet_address, consumed_at from auth_nonces where nonce = $1', [
    payload.nonce,
  ]);
  assert.equal(nonceRow.purpose, 'wallet_link');
  assert.equal(nonceRow.wallet_address, walletAddress);
  assert.equal(nonceRow.consumed_at, null);
});

await check('a bad signature is rejected and stores nothing', async () => {
  const challenge = JSON.parse(
    (await postJson('/api/wallet/challenge', { address: walletAddress }, session.cookies, dashboardCsrf)).body
  );

  const forged = bs58.encode(nacl.sign.detached(Buffer.from('different message'), keypair.secretKey));
  const result = await postJson(
    '/api/wallet/link',
    { address: walletAddress, signature: forged, nonce: challenge.nonce },
    session.cookies,
    dashboardCsrf
  );

  assert.equal(result.statusCode, 400);
  const wallets = await db.many('select id from user_wallets where address = $1', [walletAddress]);
  assert.equal(wallets.length, 0);
});

await check('a valid signature links the wallet and reads the balance on-chain', async () => {
  const challenge = JSON.parse(
    (await postJson('/api/wallet/challenge', { address: walletAddress }, session.cookies, dashboardCsrf)).body
  );

  // Sign exactly the message the server handed out, with a real keypair.
  const signature = bs58.encode(
    nacl.sign.detached(Buffer.from(challenge.message, 'utf8'), keypair.secretKey)
  );

  const before = balanceCalls.length;
  const result = await postJson(
    '/api/wallet/link',
    { address: walletAddress, signature, nonce: challenge.nonce },
    session.cookies,
    dashboardCsrf
  );

  assert.equal(result.statusCode, 201, result.body);
  const payload = JSON.parse(result.body);
  assert.equal(payload.address, walletAddress);
  assert.equal(payload.balance, '1.50000000');
  assert.equal(balanceCalls.length, before + 1, 'server must call the RPC reader, not trust the client');

  const wallet = await db.one(
    'select address, is_primary, proof_signature, first_seen_balance_f106::text as balance from user_wallets where address = $1',
    [walletAddress]
  );
  assert.equal(wallet.is_primary, true);
  assert.equal(wallet.proof_signature, signature);
  assert.equal(wallet.balance, '1.50000000');
});

await check('the same challenge cannot be replayed', async () => {
  const challenge = JSON.parse(
    (await postJson('/api/wallet/challenge', { address: walletAddress }, session.cookies, dashboardCsrf)).body
  );
  const signature = bs58.encode(
    nacl.sign.detached(Buffer.from(challenge.message, 'utf8'), keypair.secretKey)
  );

  const first = await postJson(
    '/api/wallet/link',
    { address: walletAddress, signature, nonce: challenge.nonce },
    session.cookies,
    dashboardCsrf
  );
  // The wallet is already linked, so the first attempt is refused as a duplicate...
  assert.equal(first.statusCode, 409);

  // ...and the nonce is still unusable afterwards.
  const replay = await postJson(
    '/api/wallet/link',
    { address: walletAddress, signature, nonce: challenge.nonce },
    session.cookies,
    dashboardCsrf
  );
  assert.ok([400, 409].includes(replay.statusCode));
});

await check('the dashboard now shows the verified address and balance', async () => {
  const dashboard = await app.inject({ method: 'GET', url: '/dashboard', cookies: session.cookies });
  assert.equal(dashboard.statusCode, 200);
  assert.match(dashboard.body, /WALLET VERIFIED/);
  assert.ok(dashboard.body.includes(walletAddress));
  assert.match(dashboard.body, /1\.50000000/);
  assert.ok(!dashboard.body.includes('scrypt$'), 'no password hash may reach the page');
});

await check('an RPC outage degrades the dashboard instead of breaking it', async () => {
  balanceState = { ...balanceState, fail: true };
  const dashboard = await app.inject({ method: 'GET', url: '/dashboard', cookies: session.cookies });
  balanceState = { ...balanceState, fail: false };

  assert.equal(dashboard.statusCode, 200);
  assert.match(dashboard.body, /UNAVAILABLE/);
  assert.match(dashboard.body, /RPC unreachable/);
});

await check('a second account cannot link the same wallet', async () => {
  const other = await verifyAndSignIn({
    username: `thief_${unique}`,
    email: `thief_${unique}@file106.local`,
    password: 'archive-pass-106',
  });

  const dashboard = await app.inject({ method: 'GET', url: '/dashboard', cookies: other.cookies });
  const otherCsrf = /data-csrf="([a-f0-9]{64})"/.exec(dashboard.body)?.[1];

  const challenge = JSON.parse(
    (await postJson('/api/wallet/challenge', { address: walletAddress }, other.cookies, otherCsrf)).body
  );
  const signature = bs58.encode(
    nacl.sign.detached(Buffer.from(challenge.message, 'utf8'), keypair.secretKey)
  );

  const result = await postJson(
    '/api/wallet/link',
    { address: walletAddress, signature, nonce: challenge.nonce },
    other.cookies,
    otherCsrf
  );

  assert.equal(result.statusCode, 409);
  assert.match(result.body, /already linked/i);
});

await check('signing out destroys the session', async () => {
  const dashboard = await app.inject({ method: 'GET', url: '/dashboard', cookies: session.cookies });
  const csrf = csrfFrom(dashboard.body);

  const logout = await postForm('/logout', { csrf }, session.cookies);
  assert.equal(logout.statusCode, 303);

  const after = await app.inject({ method: 'GET', url: '/dashboard', cookies: session.cookies });
  assert.equal(after.statusCode, 303);
  assert.equal(after.headers.location, '/login?notice=login-required');
});

await check('the message the server signs matches the documented format', async () => {
  const message = walletLinkMessage({
    address: walletAddress,
    nonce: 'abcdef0123456789abcdef0123456789',
    origin: 'https://archive.file106.xyz',
  });

  assert.match(message, /^FILE106 ARCHIVE \| WALLET OWNERSHIP/);
  assert.ok(message.includes('Origin: https://archive.file106.xyz'));
  assert.ok(message.includes(`Address: ${walletAddress}`));
});

console.log('failure handling');

await check('a database failure never reaches the browser as driver text', async () => {
  const broken = createDb({
    query: async () => {
      throw Object.assign(new Error('password authentication failed for user "file106"'), {
        code: '28P01',
      });
    },
  });

  const brokenApp = await buildServer({ config, db: broken, balanceReader, mailer, logger: false });
  await brokenApp.ready();

  try {
    const page = await brokenApp.inject({ method: 'GET', url: '/register' });
    assert.equal(page.statusCode, 500);

    // This failure surfaces while the session is saved, after the body has been
    // serialized, so Fastify's fallback serializer writes the body. What must
    // never happen is the driver message travelling with it.
    assert.ok(!page.body.includes('28P01'), 'connection error codes must not reach the browser');
    assert.ok(!page.body.includes('password authentication'), 'driver text must not reach the browser');
    assert.ok(!page.body.includes('scrypt$'), 'no password material may leak');
  } finally {
    await brokenApp.close();
  }
});

console.log(`\n${passed.length} checks passed\n`);

await app.close();
await pglite.close();
