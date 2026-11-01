// Stage 2 unit gate for the session store.
//
// Run: node app/tests/session.test.mjs
//
// The store is what makes "regenerate on sign-in" and "revoke a session" real.
// A write is only accepted when the caller's expected generation still matches,
// so a cookie captured before sign-in can never be upgraded into the live
// session, and a deleted row logs the holder out on the next request.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

import { createDb } from '../db.js';
import { applyMigrations } from '../migrate.js';
import { createSessionStore } from '../lib/session-store.js';

const passed = [];
const check = async (name, fn) => {
  await fn();
  passed.push(name);
  console.log(`  PASS  ${name}`);
};

const pglite = new PGlite();
const db = createDb({
  query: (text, params) => pglite.query(text, params),
  exec: (text) => pglite.exec(text),
});
await applyMigrations({ db, log: { info: () => {} } });

const store = createSessionStore({ db, ttlSeconds: 3600 });

// The plugin passes callbacks; wrap them so a failing assertion still reports.
const call = (method, ...args) =>
  new Promise((resolve, reject) => {
    store[method](...args, (error, value) => (error ? reject(error) : resolve(value)));
  });

const cookie = (minutes = 60) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: false,
  expires: new Date(Date.now() + minutes * 60_000).toISOString(),
});

const newSession = (generation, extra = {}) => ({
  cookie: cookie(),
  csrf: 'c'.repeat(64),
  __fastifySessionMetadata: { generation },
  ...extra,
});

// ---------------------------------------------------------------------
console.log('write and read');

const storeId = 'store-1';
const firstGeneration = 'gen-1';

await check('a new session is written and read back with its generation', async () => {
  await call('set', storeId, newSession(firstGeneration));

  const restored = await call('get', storeId);
  assert.ok(restored, 'session should exist');
  assert.equal(restored.csrf, 'c'.repeat(64));
  assert.equal(restored.__fastifySessionMetadata.generation, firstGeneration);

  const row = await db.one('select token_hash, user_id, generation from sessions where generation = $1', [
    firstGeneration,
  ]);
  assert.ok(row);
  assert.equal(row.user_id, null, 'an anonymous session claims no owner');
  assert.ok(Buffer.isBuffer(row.token_hash) || row.token_hash instanceof Uint8Array);
});

await check('the stored key is a digest, never the cookie value', async () => {
  const rows = await db.many('select encode(token_hash, $1) as hex from sessions', ['hex']);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.match(row.hex, /^[0-9a-f]{64}$/);
    assert.ok(!row.hex.includes(storeId), 'raw store id must not appear in the key');
  }
});

console.log('compare and set');

await check('a stale generation is refused and changes nothing', async () => {
  await assert.rejects(
    () => call('compareAndSet', storeId, 'gen-0', newSession('gen-2', { userId: randomUUID() })),
    (error) => error.code === 'ENOENT'
  );
  const restored = await call('get', storeId);
  assert.equal(restored.__fastifySessionMetadata.generation, firstGeneration);
  assert.equal(restored.userId, undefined, 'the refused write must not have landed');
});

await check('a matching generation is accepted and advances the session', async () => {
  // A real participant row, because sessions.user_id is a foreign key on
  // purpose: a session may never point at an account that does not exist.
  const userId = (
    await db.one(
      `insert into users (username, email, password_hash, status)
       values ('session_test', 'session_test@file106.local', 'scrypt$test', 'active')
       returning id`
    )
  ).id;
  const next = newSession('gen-2', { userId });

  await call('compareAndSet', storeId, firstGeneration, next);

  const restored = await call('get', storeId);
  assert.equal(restored.userId, userId);
  assert.equal(restored.__fastifySessionMetadata.generation, 'gen-2');

  const row = await db.one('select user_id from sessions where generation = $1', ['gen-2']);
  assert.equal(row.user_id, userId, 'the principal is recorded for revocation queries');
});

await check('the same generation cannot be used twice', async () => {
  await assert.rejects(
    () => call('compareAndSet', storeId, firstGeneration, newSession('gen-3')),
    (error) => error.code === 'ENOENT'
  );
});

await check('a non-uuid principal never reaches the foreign key', async () => {
  const other = 'store-uuid-guard';
  await call('set', other, newSession('gen-uuid'));
  await call('compareAndSet', other, 'gen-uuid', newSession('gen-uuid-2', { userId: 'admin-session' }));

  const row = await db.one('select user_id from sessions where generation = $1', ['gen-uuid-2']);
  assert.equal(row.user_id, null);
});

console.log('expiry and revocation');

await check('an expired session reads as absent and is removed', async () => {
  const expired = 'store-expired';
  const session = newSession('gen-expired');
  session.cookie.expires = new Date(Date.now() - 60_000).toISOString();
  await call('set', expired, session);

  // The store writes a future expiry from its own ttl, so force the row stale.
  await db.query('update sessions set expires_at = now() - interval \'1 minute\' where generation = $1', [
    'gen-expired',
  ]);

  assert.equal(await call('get', expired), null);
  const row = await db.one('select id from sessions where generation = $1', ['gen-expired']);
  assert.equal(row, null);
});

await check('a revoked session is invisible and unwritable', async () => {
  await db.query('update sessions set revoked_at = now() where generation = $1', ['gen-2']);

  assert.equal(await call('get', storeId), null);
  await assert.rejects(
    () => call('compareAndSet', storeId, 'gen-2', newSession('gen-4')),
    (error) => error.code === 'ENOENT'
  );
});

await check('destroy removes the row outright', async () => {
  await call('destroy', 'store-uuid-guard');
  const row = await db.one('select id from sessions where generation = $1', ['gen-uuid-2']);
  assert.equal(row, null);
  assert.equal(await call('get', 'store-uuid-guard'), null);
});

await check('a sweep clears expired and revoked rows', async () => {
  await store.sweep();
  const rows = await db.many('select generation, expires_at, revoked_at from sessions');
  for (const row of rows) {
    assert.ok(new Date(row.expires_at).getTime() > Date.now(), `expired row survived: ${row.generation}`);
    assert.equal(row.revoked_at, null, `revoked row survived: ${row.generation}`);
  }
});

console.log(`\n${passed.length} checks passed\n`);

await pglite.close();
