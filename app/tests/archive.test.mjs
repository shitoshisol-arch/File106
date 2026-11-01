// Stage 3 gate: the public archive, the archivist terminal, sealed answers and
// private attachments.
//
// Run: node app/tests/archive.test.mjs
//
// The acceptance criterion this file exists for is the promise in
// docs/ARCHITECTURE.md: an archivist creates a file with an answer, and that
// answer appears nowhere in the HTML or any API response. That is asserted
// against every page the public and the panel can reach, and against the row
// stored in Postgres.
//
// Real here: HTTP routing, sessions, CSRF, scrypt hashing, the database triggers
// that freeze an answer, the audit table, and filesystem uploads in a temporary
// directory. Stubbed: the Solana RPC read.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { createDb } from '../db.js';
import { applyMigrations } from '../migrate.js';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashSecret } from '../../scripts/archive/secret-hash.mjs';

const passed = [];
const check = async (name, fn) => {
  await fn();
  passed.push(name);
  console.log(`  PASS  ${name}`);
};

// ---------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------
const uploadDir = join(tmpdir(), `file106-uploads-${randomBytes(4).toString('hex')}`);

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

// Mutable, so the reward-gate checks can move the holding and make the RPC
// fail without rebuilding the server.
let holding = { amount: '1.50000000', baseUnits: 150000000n, decimals: 8 };
const balanceReader = async () => {
  if (holding instanceof Error) throw holding;
  return holding;
};
const mailer = { delivered: false, async send() { return { delivered: false }; } };

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

// ---------------------------------------------------------------------
// Fixtures: an archivist and a participant, created the way production does it
// (hashSecret), because the CLI and the sign-in form must agree on the format.
// ---------------------------------------------------------------------
const ADMIN = { email: 'archivist@f106.test', password: 'archivist-pass-106', name: 'Test Archivist' };
const HOLDER = { username: 'holder', email: 'holder@f106.test', password: 'participant-pass-106' };

await db.query(
  `insert into admin_users (email, display_name, password_hash, role)
   values ($1, $2, $3, 'owner')`,
  [ADMIN.email, ADMIN.name, hashSecret(ADMIN.password)]
);

await db.query(
  `insert into users (username, email, password_hash, status, email_verified_at)
   values ($1, $2, $3, 'active', now())`,
  [HOLDER.username, HOLDER.email, hashSecret(HOLDER.password)]
);

// ---------------------------------------------------------------------
console.log('public archive before anything is published');

let anonymous;

await check('the archive says the vault is sealed rather than showing an error', async () => {
  const page = await getPage('/archive');
  anonymous = page.cookies;
  assert.equal(page.response.statusCode, 200);
  assert.match(page.response.body, /FILES IN CUSTODY/);
  assert.match(page.response.body, /THE VAULT IS SEALED/);
});

await check('an unknown file is the archive 404, not a stack trace', async () => {
  const { response } = await getPage('/archive/file-999');
  assert.equal(response.statusCode, 404);
  assert.match(response.body, /NO SUCH RECORD/);
});

console.log('archivist access control');

await check('the panel sends an anonymous visitor to the archivist sign-in', async () => {
  const { response } = await getPage('/admin');
  assert.equal(response.statusCode, 303);
  assert.equal(response.headers.location, '/admin/login?notice=admin-required');
});

await check('a participant session is not an archivist session', async () => {
  const loginPage = await getPage('/login');
  const result = await postForm(
    '/login',
    { csrf: csrfFrom(loginPage.response.body), email: HOLDER.email, password: HOLDER.password },
    loginPage.cookies
  );
  assert.equal(result.statusCode, 303);

  const participant = mergeCookies(loginPage.cookies, cookieJar(result));

  // Signed in, but a participant: the panel must still refuse, and the refusal
  // is a redirect rather than a page that renders the panel shell.
  const panel = await app.inject({ method: 'GET', url: '/admin', cookies: participant });
  assert.equal(panel.statusCode, 303);
  assert.equal(panel.headers.location, '/admin/login?notice=admin-required');
  assert.ok(!panel.body.includes('FILE MANAGER'));

  // The API surface refuses too, with 401 rather than an HTML page.
  const api = await app.inject({
    method: 'PUT',
    url: '/api/admin/files/00000000-0000-0000-0000-000000000000/attachments?filename=x.png',
    payload: Buffer.from([1, 2, 3]),
    cookies: participant,
    headers: { 'content-type': 'image/png', 'x-csrf-token': 'a'.repeat(64) },
  });
  assert.equal(api.statusCode, 401);
  assert.equal(JSON.parse(api.body).error, 'admin_required');
});

await check('a wrong archivist password is refused without creating a session', async () => {
  const page = await getPage('/admin/login');
  const result = await postForm(
    '/admin/login',
    { csrf: csrfFrom(page.response.body), email: ADMIN.email, password: 'not-the-password' },
    page.cookies
  );

  assert.equal(result.statusCode, 401);
  assert.match(result.body, /INVALID EMAIL OR PASSWORD/);

  const after = await app.inject({
    method: 'GET',
    url: '/admin',
    cookies: mergeCookies(page.cookies, cookieJar(result)),
  });
  assert.equal(after.statusCode, 303);
});

let admin;
let adminCsrf;

await check('the archivist signs in and the sign-in is audited', async () => {
  const page = await getPage('/admin/login');
  const result = await postForm(
    '/admin/login',
    { csrf: csrfFrom(page.response.body), email: ADMIN.email, password: ADMIN.password },
    page.cookies
  );

  assert.equal(result.statusCode, 303);
  assert.equal(result.headers.location, '/admin');

  admin = mergeCookies(page.cookies, cookieJar(result));

  const panel = await app.inject({ method: 'GET', url: '/admin', cookies: admin });
  assert.equal(panel.statusCode, 200);
  assert.match(panel.body, /Test Archivist/);
  assert.match(panel.body, /OVERVIEW/);

  adminCsrf = csrfFrom(panel.body);
  assert.ok(adminCsrf, 'the panel must carry a CSRF token');

  const audited = await db.one(
    "select count(*)::int as total from admin_audit_logs where action = 'admin.sign_in'"
  );
  assert.equal(audited.total, 1);
});

console.log('the file manager');

let fileId;
let fileSlug;
const ANSWER = 'rosemary-1962-quiet-ledger';

await check('an archivist creates a draft that the public cannot see', async () => {
  const result = await postForm(
    '/admin/files',
    {
      csrf: adminCsrf,
      fileNumber: '106',
      slug: '',
      title: 'The Quiet Ledger',
      teaser: 'A ledger with one page missing.',
      briefing: 'Read the ledger closely. The page that is missing matters more than the ones that are not.',
      difficulty: 'hard',
      winnerMethod: 'first_correct',
      reward: '250',
      minHolding: '1',
      maxWinners: '',
      opensAt: '',
      closesAt: '',
    },
    admin
  );

  assert.equal(result.statusCode, 303, result.body);
  const location = result.headers.location;
  assert.match(location, /^\/admin\/files\/[0-9a-f-]{36}\?notice=file-created$/);
  fileId = location.split('/')[3].split('?')[0];

  const row = await db.one('select status, slug, reward_amount_f106::text as reward from files where id = $1', [fileId]);
  assert.equal(row.status, 'draft');
  assert.equal(row.slug, 'file-106', 'a blank slug derives from the file number');
  assert.equal(row.reward, '250.00000000');
  fileSlug = row.slug;

  const list = await app.inject({ method: 'GET', url: '/archive', cookies: anonymous });
  assert.ok(!list.body.includes('The Quiet Ledger'), 'a draft must not appear in the public list');

  const direct = await app.inject({ method: 'GET', url: `/archive/${fileSlug}`, cookies: anonymous });
  assert.equal(direct.statusCode, 404, 'a draft must not be reachable by slug either');
});

await check('a duplicate file number is refused rather than overwriting', async () => {
  const result = await postForm(
    '/admin/files',
    {
      csrf: adminCsrf,
      fileNumber: '106',
      title: 'Another File',
      teaser: 'Different title, same number.',
      difficulty: 'easy',
      reward: '10',
      minHolding: '1',
      winnerMethod: 'first_correct',
    },
    admin
  );

  assert.equal(result.statusCode, 409);
  assert.match(result.body, /already in use/i);
  const rows = await db.many('select id from files');
  assert.equal(rows.length, 1);
});

await check('an impossible reward is rejected by validation', async () => {
  const result = await postForm(
    '/admin/files',
    {
      csrf: adminCsrf,
      fileNumber: '107',
      title: 'Bad Reward',
      teaser: 'This should not be stored.',
      difficulty: 'easy',
      reward: '0',
      minHolding: '1',
      winnerMethod: 'first_correct',
    },
    admin,
  );

  assert.equal(result.statusCode, 400);
  const rows = await db.many('select id from files where file_number = 107');
  assert.equal(rows.length, 0);
});

await check('publishing is a status change on the same record', async () => {
  const result = await postForm(`/admin/files/${fileId}/status`, { csrf: adminCsrf, status: 'open' }, admin);
  assert.equal(result.statusCode, 303);

  const list = await app.inject({ method: 'GET', url: '/archive', cookies: anonymous });
  assert.equal(list.statusCode, 200);
  assert.match(list.body, /The Quiet Ledger/);
  assert.match(list.body, /OPEN/);

  const page = await app.inject({ method: 'GET', url: `/archive/${fileSlug}`, cookies: anonymous });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /A ledger with one page missing/);
  assert.match(page.body, /ACCOUNT REQUIRED/);
});

console.log('the reward gate on the home page');

await check('the home page carries the gate with the numbers the database holds', async () => {
  const { response } = await getPage('/');

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /REWARD GATE/);
  assert.match(response.body, /FILES OPEN/);
  assert.match(response.body, /250\.00000000/);
  assert.match(response.body, /MINIMUM HOLDING/);
  assert.match(response.body, /1\.00000000/);
  // Anonymous sees the rule and the way in, never a balance.
  assert.match(response.body, /ACCOUNT REQUIRED/);

  // A page that names someone's holding must not be cacheable for the next
  // visitor; a shared cache here would leak balances between participants.
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(String(response.headers.vary), /cookie/i);
});

await check('the page has one address, so the filename redirects to the gate', async () => {
  // site/index.html is still published for GitHub Pages and still served by
  // the static handler's wildcard; without this the same page would answer on
  // two URLs, one of them carrying an unrendered gate marker.
  const { response } = await getPage('/index.html');

  assert.equal(response.statusCode, 301);
  assert.equal(response.headers.location, '/');
});

let holder;

await check('a signed-in participant with no wallet is told to link one', async () => {
  const page = await getPage('/login');
  const result = await postForm(
    '/login',
    { csrf: csrfFrom(page.response.body), email: HOLDER.email, password: HOLDER.password },
    page.cookies
  );
  assert.equal(result.statusCode, 303);
  holder = mergeCookies(page.cookies, cookieJar(result));

  const { response } = await getPage('/', holder);
  assert.match(response.body, /LINK A WALLET/);
  assert.match(response.body, /holder/);
  assert.ok(!response.body.includes('GATE OPEN'), 'no wallet means no verdict');
});

await check('the gate opens only when the on-chain holding clears the lowest gate', async () => {
  await db.query(
    `insert into user_wallets (user_id, address, is_primary, proof_nonce, proof_message, proof_signature)
     select id, $1, true, 'nonce', 'message', 'signature' from users where email = $2`,
    ['So11111111111111111111111111111111111111112', HOLDER.email]
  );

  const opened = await getPage('/', holder);
  assert.match(opened.response.body, /GATE OPEN/);
  assert.match(opened.response.body, /1\.50000000/);

  holding = { amount: '0.40000000', baseUnits: 40000000n, decimals: 8 };
  const below = await getPage('/', holder);
  assert.match(below.response.body, /BELOW THE GATE/);
  assert.match(below.response.body, /0\.40000000/);
  assert.match(below.response.body, /1\.00000000/);

  // An RPC failure is a state, not a crash: the trust page still has to render.
  holding = new Error('rpc down');
  const down = await getPage('/', holder);
  assert.equal(down.response.statusCode, 200);
  assert.match(down.response.body, /CHAIN UNREACHABLE/);
  assert.match(down.response.body, /FILE106/);

  holding = { amount: '1.50000000', baseUnits: 150000000n, decimals: 8 };
});

console.log('the answer');

let answerHash;

await check('the answer is sealed as a scrypt hash and stored nowhere in readable form', async () => {
  const result = await postForm(
    `/admin/files/${fileId}/challenge`,
    {
      csrf: adminCsrf,
      prompt: 'What was on the missing page?',
      answer: ANSWER,
      answerFormat: 'text',
      maxAttempts: '1',
    },
    admin
  );

  assert.equal(result.statusCode, 303);
  assert.match(result.headers.location, /notice=answer-saved$/);

  const row = await db.one('select answer_hash, answer_format from challenges where file_id = $1', [fileId]);
  answerHash = row.answer_hash;

  assert.match(answerHash, /^scrypt\$/);
  assert.notEqual(answerHash, ANSWER);
  assert.ok(!answerHash.includes(ANSWER));

  // Nothing in the row may echo the plaintext back.
  assert.ok(!JSON.stringify(row).includes(ANSWER));
});

await check('the answer and its hash are absent from every page and API response', async () => {
  const targets = [
    ['/', anonymous],
    ['/archive', anonymous],
    [`/archive/${fileSlug}`, anonymous],
    ['/admin', admin],
    ['/admin/files', admin],
    [`/admin/files/${fileId}`, admin],
    ['/api/wallet/balance', admin],
  ];

  for (const [url, cookies] of targets) {
    const { body, statusCode } = await app.inject({ method: 'GET', url, cookies });
    assert.ok(statusCode < 500, `${url} answered ${statusCode}`);
    assert.ok(!body.includes(ANSWER), `${url} leaked the answer`);
    assert.ok(!body.includes(answerHash), `${url} leaked the answer hash`);
    assert.ok(!body.includes('scrypt$'), `${url} leaked a hash in any form`);
  }
});

await check('the audit trail records the change without recording the answer', async () => {
  const rows = await db.many(
    "select action, after_state from admin_audit_logs where entity in ('files', 'challenges') order by id"
  );

  const actions = rows.map((row) => row.action);
  assert.ok(actions.includes('file.create'));
  assert.ok(actions.includes('file.status'));
  assert.ok(actions.includes('challenge.answer_set'));

  const serialised = JSON.stringify(rows);
  assert.ok(!serialised.includes(ANSWER), 'the audit log must not contain the answer');
  assert.ok(!serialised.includes('scrypt$'), 'the audit log must not contain the hash');
});

await check('an answer cannot be replaced once someone has submitted against it', async () => {
  const challenge = await db.one('select id from challenges where file_id = $1', [fileId]);
  const user = await db.one('select id from users where email = $1', [HOLDER.email]);

  await db.query(
    `insert into submissions
       (file_id, challenge_id, user_id, attempt_no, wallet_address,
        answer_ciphertext, answer_digest,
        holding_checked_at, holding_snapshot_f106, holding_required_f106, holding_satisfied)
     values ($1, $2, $3, 1, $4, $5, $6, now(), 1.5, 1, true)`,
    [
      fileId,
      challenge.id,
      user.id,
      'So11111111111111111111111111111111111111112',
      Buffer.from('sealed'),
      Buffer.from('digest'),
    ]
  );

  const result = await postForm(
    `/admin/files/${fileId}/challenge`,
    { csrf: adminCsrf, prompt: 'What was on the missing page?', answer: 'a-new-answer', answerFormat: 'text', maxAttempts: '1' },
    admin
  );

  assert.equal(result.statusCode, 409);
  assert.match(result.body, /CANNOT CHANGE/);

  const row = await db.one('select answer_hash from challenges where file_id = $1', [fileId]);
  assert.equal(row.answer_hash, answerHash, 'the stored answer must be untouched');
});

console.log('private attachments');

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('an exhibit no visitor may fetch', 'utf8'),
]);

let attachmentId;
let storageKey;

await check('an attachment is stored privately and served only to an archivist', async () => {
  const upload = await app.inject({
    method: 'PUT',
    url: `/api/admin/files/${fileId}/attachments?filename=ledger.png`,
    payload: PNG,
    cookies: admin,
    headers: { 'content-type': 'image/png', 'x-csrf-token': adminCsrf },
  });

  assert.equal(upload.statusCode, 201, upload.body);
  const payload = JSON.parse(upload.body);
  attachmentId = payload.id;
  assert.equal(payload.filename, 'ledger.png');

  const row = await db.one('select storage_key, mime_type, checksum_sha256 from file_attachments where id = $1', [attachmentId]);
  storageKey = row.storage_key;
  assert.match(storageKey, /^[a-f0-9]{32}$/, 'the storage key is random, not derived from the filename');
  assert.equal(row.mime_type, 'image/png');

  // The bytes really are on disk outside the served directory.
  const onDisk = await readFile(join(uploadDir, storageKey));
  assert.ok(onDisk.equals(PNG));

  const download = await app.inject({ method: 'GET', url: `/admin/attachments/${attachmentId}`, cookies: admin });
  assert.equal(download.statusCode, 200);
  assert.ok(Buffer.from(download.rawPayload).equals(PNG));
  assert.match(download.headers['content-disposition'], /^attachment; filename\*=UTF-8''ledger\.png$/);

  const anonymousFetch = await app.inject({ method: 'GET', url: `/admin/attachments/${attachmentId}` });
  assert.equal(anonymousFetch.statusCode, 303, 'no session may download an attachment');

  // The public file page must not mention the key, the name or the record.
  const publicPage = await app.inject({ method: 'GET', url: `/archive/${fileSlug}` });
  assert.ok(!publicPage.body.includes(storageKey));
  assert.ok(!publicPage.body.includes('ledger.png'));
});

await check('a disallowed file type never reaches the storage layer', async () => {
  const before = (await readdir(uploadDir)).length;

  const upload = await app.inject({
    method: 'PUT',
    url: `/api/admin/files/${fileId}/attachments?filename=payload.gif`,
    payload: Buffer.from('GIF89a'),
    cookies: admin,
    headers: { 'content-type': 'image/gif', 'x-csrf-token': adminCsrf },
  });

  assert.equal(upload.statusCode, 415);
  assert.equal((await readdir(uploadDir)).length, before, 'nothing was written');
});

await check('an oversized upload is refused at the transport limit', async () => {
  const upload = await app.inject({
    method: 'PUT',
    url: `/api/admin/files/${fileId}/attachments?filename=big.png`,
    payload: Buffer.concat([PNG, Buffer.alloc(70 * 1024, 1)]),
    cookies: admin,
    headers: { 'content-type': 'image/png', 'x-csrf-token': adminCsrf },
  });

  assert.equal(upload.statusCode, 413);
});

await check('removing an attachment deletes both the record and the bytes', async () => {
  const result = await postForm(`/admin/files/${fileId}/attachments/${attachmentId}/delete`, { csrf: adminCsrf }, admin);
  assert.equal(result.statusCode, 303);

  const rows = await db.many('select id from file_attachments where id = $1', [attachmentId]);
  assert.equal(rows.length, 0);

  const remaining = await readdir(uploadDir);
  assert.ok(!remaining.includes(storageKey), 'the file must be gone from disk');
});

console.log('withdrawal');

await check('archiving removes a file from the public archive', async () => {
  await postForm(`/admin/files/${fileId}/status`, { csrf: adminCsrf, status: 'archived' }, admin);

  const list = await app.inject({ method: 'GET', url: '/archive', cookies: anonymous });
  assert.ok(!list.body.includes('The Quiet Ledger'));

  const page = await app.inject({ method: 'GET', url: `/archive/${fileSlug}`, cookies: anonymous });
  assert.equal(page.statusCode, 404);
});

await check('with nothing open the gate says the vault is sealed', async () => {
  const { response } = await getPage('/', holder);
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /THE VAULT IS SEALED/);
  assert.ok(!response.body.includes('FILES OPEN'), 'no figures are claimed when nothing is open');
});

console.log(`\n${passed.length} checks passed\n`);

await app.close();
await pglite.close();
await rm(uploadDir, { recursive: true, force: true });
