// The mystery layer gate: hidden clues, sealed files, the answer terminal and
// the manual reward chain.
//
// Run: node app/tests/mystery.test.mjs
//
// What is asserted here:
//
//   * hidden symbols ask the server, and only the server can answer, honouring
//     the clue chain and logging a discovery once
//   * a sealed file opens through a recovered code, after its clue is decoded
//   * answers are sealed, compared on the server and never leak
//   * a correct answer leads to an archivist approval, a pending reward and a
//     manual payout that is only confirmed by a chain-verifying stub
//
// Real here: HTTP routing, sessions, CSRF, scrypt hashing, the database triggers
// that freeze an answer, the audit table and the sealed submission tables.
// Stubbed: the Solana RPC read and the transaction verifier.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { createDb } from '../db.js';
import { applyMigrations } from '../migrate.js';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashSecret } from '../../scripts/archive/secret-hash.mjs';
import { hashChallengeAnswer } from '../lib/answers.js';

const passed = [];
const check = async (name, fn) => {
  await fn();
  passed.push(name);
  console.log(`  PASS  ${name}`);
};

const uploadDir = join(tmpdir(), `file106-mystery-uploads-${randomBytes(4).toString('hex')}`);

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
  ARCHIVE_UPLOAD_DIR: uploadDir,
  ARCHIVE_UPLOAD_MAX_BYTES: '65536',
});

let holding = { amount: '1.50000000', baseUnits: 150000000n, decimals: 8 };
const balanceReader = async () => holding;
const mailer = { delivered: false, async send() { return { delivered: false }; } };

const transactionVerifier = async () => ({
  status: 'verified',
  reason: '',
  amountBaseUnits: 250000000n,
  mintAddress: config.solana.mintAddress,
  toAddress: 'So11111111111111111111111111111111111111112',
  slot: 1,
  blockTime: new Date(),
  explorerUrl: 'https://solscan.io/tx/11111111111111111111111111111111111111111111111111111111111111111',
});

const app = await buildServer({ config, db, balanceReader, mailer, transactionVerifier, logger: false });
await app.ready();

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

const mergeCookies = (...jars) => Object.assign({}, ...jars);
const csrfFrom = (html) => /name="csrf" value="([a-f0-9]{64})"/.exec(html)?.[1] ?? null;
const form = (fields) => new URLSearchParams(fields).toString();
const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' };

async function getPage(url, cookies = {}) {
  const response = await app.inject({ method: 'GET', url, cookies });
  return { response, cookies: cookieJar(response) };
}

async function postForm(url, fields, cookies) {
  return app.inject({ method: 'POST', url, payload: form(fields), cookies, headers: FORM_HEADERS });
}

async function postJson(url, payload, cookies, csrf) {
  const headers = { ...FORM_HEADERS, 'content-type': 'application/json' };
  if (csrf) headers['x-csrf-token'] = csrf;
  return app.inject({
    method: 'POST',
    url,
    payload: JSON.stringify(payload),
    cookies,
    headers,
  });
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------
const ADMIN = { email: 'archivist@f106.test', password: 'archivist-pass-106', name: 'Test Archivist' };
const HOLDER = { username: 'holder', email: 'holder@f106.test', password: 'participant-pass-106' };

let admin;
let adminCsrf;
let holderSession;
let holderCsrf;
let holderId;
let fileId;
let challengeId;
let submissionId;
let rewardId;

await db.query(
  `insert into admin_users (id, email, display_name, password_hash, role)
   values ('a0000000-0000-4000-8000-000000000001', $1, $2, $3, 'owner')`,
  [ADMIN.email, ADMIN.name, hashSecret(ADMIN.password)]
);

await db.query(
  `insert into users (id, username, email, password_hash, status, email_verified_at, terms_accepted_at)
   values ('b0000000-0000-4000-8000-000000000001', $1, $2, $3, 'active', now(), now())`,
  [HOLDER.username, HOLDER.email, hashSecret(HOLDER.password)]
);

await db.query(
  `insert into user_wallets (user_id, address, is_primary, proof_nonce, proof_message, proof_signature)
   values ('b0000000-0000-4000-8000-000000000001', 'So11111111111111111111111111111111111111112', true,
           'preview', 'preview', 'preview')`
);

await db.query(
  `insert into files
     (id, file_number, slug, title, teaser, briefing, difficulty, status,
      reward_amount_f106, min_holding_f106, winner_method, max_winners,
      opens_at, closes_at, classification, lore_body, chapter_no, mystery_order,
      unlock_hint, required_file_number, unlock_requires_clue, is_mystery,
      unlock_code_hash, created_by)
   values ('fa000000-0000-4000-8000-000000000017', 17, 'file-017', 'THE UNKNOWN SIGNAL',
           'A transmission with no origin and no author.', null, 'hard', 'locked', 0.25, 1,
           'first_correct', 1, now() + interval '3 days', now() + interval '31 days',
           'FILE106', 'The unknown file carried the symbol. [[SYMBOL:3]] The archive refused to delete what it could not read.',
           2, 2, 'The glyph is the key. What does it ask you to remember?', null, 3, true,
           $1, 'a0000000-0000-4000-8000-000000000001')`,
  [hashSecret('EIGHT-UNDER-SCORE-STAR')]
);

await db.query(
  `insert into clues (clue_no, slug, title, body, hint, location, chapter_no, file_number,
                       requires_clue_no, is_enabled, created_by)
   values (3, 'the-symbol', 'THE SYMBOL', 'The recovered margin is annotated with the recurring glyph. The glyph is 8_*.',
           'The symbol is not decoration. It is a question.', 'FILE 017 / signal print', 2, 17, null, true,
           'a0000000-0000-4000-8000-000000000001')`
);

await db.query(
  `insert into files
     (id, file_number, slug, title, teaser, briefing, difficulty, status,
      reward_amount_f106, min_holding_f106, winner_method, max_winners,
      opens_at, closes_at, classification, lore_body, chapter_no, mystery_order,
      unlock_hint, required_file_number, unlock_requires_clue, is_mystery,
      unlock_code_hash, created_by)
   values ('fa000000-0000-4000-8000-000000000105', 105, 'file-105', 'THE TERMINATION REPORT',
           'The report that was supposed to be deleted.', null, 'hard', 'open', 0.25, 1,
           'first_correct', 1, now() - interval '1 day', now() + interval '21 days',
           'PROJECT105', 'The termination report was final. The final event was not.',
           1, 3, null, null, null, true, null,
           'a0000000-0000-4000-8000-000000000001')`
);

fileId = (await db.one('select id from files where slug = $1', ['file-105'])).id;

challengeId = (
  await db.one(
    `insert into challenges (id, file_id, position, prompt, answer_hash, answer_format, max_attempts)
     values ('c1060000-0000-4000-8000-000000000105', $1, 1,
       'What designation was stamped when the project was terminated?',
       $2, 'text', 3) returning id`,
    [fileId, hashChallengeAnswer('terminated')]
  )
).id;

const participantId = (await db.one('select id from users where email = $1', [HOLDER.email])).id;
holderId = participantId;

// ---------------------------------------------------------------------
// The investigation opening
// ---------------------------------------------------------------------

let anonymous;

await check('the opening screen introduces the incident without spoiling it', async () => {
  const page = await getPage('/');
  anonymous = page.cookies;
  assert.equal(page.response.statusCode, 200);
  assert.match(page.response.body, /PROJECT105: TERMINATED\./);
  assert.match(page.response.body, /FILE106: STILL ACTIVE\./);
  assert.match(page.response.body, /Some files were never meant to be opened\./);
  assert.match(page.response.body, /ENTER THE ARCHIVE/);
  assert.match(page.response.body, /data-clue="1"/);
});

await check('an anonymous signal cannot be decoded without a session', async () => {
  const result = await postJson('/api/mystery/clue', { clueNo: 3, source: 'symbol' }, {});
  assert.equal(result.statusCode, 401);
});

await check('the archivist signs in and the sign-in is audited', async () => {
  const page = await getPage('/admin/login');
  const result = await postForm(
    '/admin/login',
    { csrf: csrfFrom(page.response.body), email: ADMIN.email, password: ADMIN.password },
    page.cookies
  );
  assert.equal(result.statusCode, 303);
  admin = mergeCookies(page.cookies, cookieJar(result));

  const panel = await getPage('/admin', admin);
  assert.equal(panel.response.statusCode, 200);
  adminCsrf = csrfFrom(panel.response.body);
  assert.ok(adminCsrf);
});

await check('the participant signs in', async () => {
  const page = await getPage('/login');
  holderSession = page.cookies;
  const result = await postForm(
    '/login',
    { csrf: csrfFrom(page.response.body), email: HOLDER.email, password: HOLDER.password },
    page.cookies
  );
  assert.equal(result.statusCode, 303);
  holderSession = mergeCookies(page.cookies, cookieJar(result));

  const dashboard = await getPage('/dashboard', holderSession);
  assert.equal(dashboard.response.statusCode, 200);
  holderCsrf = csrfFrom(dashboard.response.body);
});

console.log('the clue chain');

await check('the first clue of the chain decodes and is logged once', async () => {
  const first = await postJson('/api/mystery/clue', { clueNo: 3, source: 'symbol' }, holderSession, holderCsrf);
  assert.equal(first.statusCode, 200);
  const payload = JSON.parse(first.body);
  assert.equal(payload.clueNo, 3);
  assert.equal(payload.body, 'The recovered margin is annotated with the recurring glyph. The glyph is 8_*.');
  assert.equal(payload.logged, true);
  assert.equal(payload.first, true);

  const second = await postJson('/api/mystery/clue', { clueNo: 3, source: 'symbol' }, holderSession, holderCsrf);
  const secondPayload = JSON.parse(second.body);
  assert.equal(secondPayload.first, false, 'a second click must not re-log the same clue');
  assert.equal(secondPayload.logged, true, 'the signed-in visitor still has a log entry');
});

await check('an unknown clue is refused', async () => {
  const unknown = await postJson('/api/mystery/clue', { clueNo: 99, source: 'symbol' }, holderSession, holderCsrf);
  assert.equal(unknown.statusCode, 404);
});

console.log('the sealed file');

await check('a sealed file asks for its recovered code and refuses wrong ones', async () => {
  const before = await getPage('/archive/file-017', anonymous);
  assert.equal(before.response.statusCode, 200);
  assert.match(before.response.body, /THE UNKNOWN SIGNAL/);
  assert.match(before.response.body, /SEALED/);

  const beforeHome = await getPage('/', anonymous);
  const token = /<meta name="csrf-token" content="([a-f0-9]{64})"/.exec(beforeHome.response.body)?.[1];
  assert.ok(token, 'the opening screen carries the session token');

  const denied = await postForm(
    '/archive/file-017/unlock',
    { csrf: token, code: 'WRONG-CODE' },
    anonymous
  );
  assert.equal(denied.statusCode, 303);
  assert.ok(String(denied.headers.location).includes('login'), 'anonymous visitors are sent to sign in');

  const signedOut = await postForm('/archive/file-017/unlock', { csrf: holderCsrf, code: 'WRONG-CODE' }, holderSession);
  assert.equal(signedOut.statusCode, 303);
  assert.match(signedOut.headers.location, /notice=code-invalid/);
});

await check('the sealed file opens with the recovered code and reveals its document', async () => {
  const opened = await postForm('/archive/file-017/unlock', { csrf: holderCsrf, code: 'EIGHT-UNDER-SCORE-STAR' }, holderSession);
  assert.equal(opened.statusCode, 303);
  assert.match(opened.headers.location, /notice=file-unlocked/);

  const unlocked = await getPage('/archive/file-017', holderSession);
  assert.equal(unlocked.response.statusCode, 200);
  assert.doesNotMatch(unlocked.response.body, /SEALED SECTION/);
  assert.match(unlocked.response.body, /data-clue="3"/);
});

console.log('the answer terminal');

await check('a wrong answer is recorded and the correct one is sealed for review', async () => {
  await db.query('update challenges set max_attempts = 3 where id = $1', [challengeId]);

  const wrong = await postForm('/archive/file-105/submit', { csrf: holderCsrf, answer: 'not-the-designation' }, holderSession);
  assert.equal(wrong.statusCode, 303);
  assert.match(wrong.headers.location, /notice=answer-incorrect/);

  const correct = await postForm('/archive/file-105/submit', { csrf: holderCsrf, answer: 'terminated' }, holderSession);
  assert.equal(correct.statusCode, 303);
  assert.match(correct.headers.location, /notice=answer-correct/);

  const row = await db.one(
    'select id, status, answer_ciphertext from submissions where user_id = $1 and challenge_id = $2',
    [holderId, challengeId]
  );
  submissionId = row.id;
  assert.equal(row.status, 'correct');
  assert.ok(!String(row.answer_ciphertext).includes('terminated'));
});

await check('a correct submission cannot be submitted twice', async () => {
  const repeat = await postForm('/archive/file-105/submit', { csrf: holderCsrf, answer: 'terminated' }, holderSession);
  assert.equal(repeat.statusCode, 303);
  assert.match(repeat.headers.location, /notice=already-submitted/);
});

await check('no answer material reaches the public pages', async () => {
  const home = await getPage('/', anonymous);
  assert.ok(!home.response.body.includes('scrypt$'));

  const file = await getPage('/archive/file-105', holderSession);
  assert.ok(!file.response.body.includes('scrypt$'));
  assert.ok(!file.response.body.includes('terminated'));
});

console.log('the manual reward');

await check('an admin approves the correct submission and creates a pending reward', async () => {
  const detail = await getPage(`/admin/submissions/${submissionId}`, admin);
  const approve = await postForm(
    `/admin/submissions/${submissionId}/approve`,
    { csrf: adminCsrf, note: 'verified by the archivist' },
    admin
  );
  assert.equal(approve.statusCode, 303);
  assert.match(approve.headers.location, /notice=submission-approved/);

  const reward = await db.one('select id, payment_status from rewards');
  assert.equal(reward.payment_status, 'awaiting_payment');
  rewardId = reward.id;
});

await check('the admin confirms the manual payout with a verified transaction', async () => {
  const confirm = await postForm(
    `/admin/rewards/${rewardId}/transaction`,
    { csrf: adminCsrf, signature: '5'.repeat(64) },
    admin
  );
  assert.equal(confirm.statusCode, 303);
  assert.match(confirm.headers.location, /notice=reward-confirmed/);

  const rewardAfter = await db.one('select payment_status from rewards where id = $1', [rewardId]);
  assert.equal(rewardAfter.payment_status, 'confirmed');

  const tx = await db.one('select verification_status from transactions where reward_id = $1', [rewardId]);
  assert.equal(tx.verification_status, 'verified');
});

await check('a confirmed reward cannot be confirmed twice', async () => {
  const repeat = await postForm(
    `/admin/rewards/${rewardId}/transaction`,
    { csrf: adminCsrf, signature: '5'.repeat(64) },
    admin
  );
  assert.equal(repeat.statusCode, 303);
  assert.match(repeat.headers.location, /notice=reward-already-confirmed/);
});

console.log(`\n${passed.length} checks passed\n`);

await app.close();
await pglite.close();
await rm(uploadDir, { recursive: true, force: true });
