// Executes db/migrations/0001_init.sql and db/seed/0001_devnet_seed.sql against a
// real PostgreSQL engine (PGlite = Postgres compiled to WASM, no server needed),
// then proves the safety rules actually fire.
//
// Run: node db/tests/schema.test.mjs
//
// This is the gate that has to pass before any stage is merged: if a constraint
// or guard trigger is silently missing, the test fails.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (rel) => readFile(join(root, rel), 'utf8');

const passed = [];
const check = async (name, fn) => {
  await fn();
  passed.push(name);
  console.log(`  PASS  ${name}`);
};

const db = new PGlite();
await db.exec(await read('db/migrations/0001_init.sql'));
await db.exec(await read('db/migrations/0005_mystery.sql'));
await db.exec(await read('db/seed/0001_devnet_seed.sql'));
await db.exec(await read('db/seed/0002_mystery_seed.sql'));

const one = async (sql, params) => {
  const { rows } = await db.query(sql, params);
  return rows[0];
};

console.log('schema');

await check('all documented tables exist', async () => {
  const expected = [
    'admin_users', 'users', 'user_wallets', 'verification_tokens', 'auth_nonces',
    'sessions', 'settings', 'files', 'file_attachments', 'challenges', 'submissions',
    'winners', 'rewards', 'transactions', 'partnerships', 'partnership_campaigns',
    'campaign_tasks', 'social_verifications', 'user_campaign_progress', 'admin_audit_logs',
    'story_chapters', 'clues', 'user_clue_discoveries', 'file_unlocks', 'investigation_logs',
  ];
  const { rows } = await db.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`
  );
  const found = new Set(rows.map((r) => r.table_name));
  for (const table of expected) assert.ok(found.has(table), `missing table: ${table}`);
});

await check('transparency and analytics views exist', async () => {
  const { rows } = await db.query(
    `select table_name from information_schema.views where table_schema = 'public'`
  );
  const found = new Set(rows.map((r) => r.table_name));
  for (const view of ['v_public_winners', 'v_file_stats', 'v_campaign_stats']) {
    assert.ok(found.has(view), `missing view: ${view}`);
  }
});

await check('seed produces a pending submission and an unpaid winner', async () => {
  const pending = await one(`select count(*)::int as n from submissions where status = 'pending_review'`);
  const unpaid = await one(`select count(*)::int as n from rewards where payment_status = 'awaiting_payment'`);
  assert.equal(pending.n, 1);
  assert.equal(unpaid.n, 1);
});

await check('public winners view hides unpaid rewards and private data', async () => {
  const { rows } = await db.query(`select * from v_public_winners`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, 'ghost_archive');
  assert.equal(rows[0].payment_status, 'awaiting_payment');
  assert.equal(rows[0].signature, null, 'no transaction should exist yet');
  assert.ok(!('email' in rows[0]));
});

await check('a pending submission is not publicly visible as a winner', async () => {
  const { rows } = await db.query(
    `select * from v_public_winners where file_number = 106`
  );
  assert.equal(rows.length, 0);
});

console.log('sybil and duplication guards');

await check('one Solana address cannot be linked to a second account', async () => {
  await assert.rejects(
    db.query(
      `insert into user_wallets (user_id, address, proof_nonce, proof_message, proof_signature)
       values ('b0000000-0000-4000-8000-000000000001',
               '8zaiNx6CLFhHHEfFTN1nAkHWwPHDvKazmMHcbwRtQ8df', 'n', 'm', 's')`
    ),
    /user_wallets_address_key|duplicate key/
  );
});

await check('a user cannot submit the same challenge attempt twice', async () => {
  await assert.rejects(
    db.query(
      `insert into submissions (file_id, challenge_id, user_id, wallet_address,
                                answer_ciphertext, answer_digest, holding_checked_at,
                                holding_snapshot_f106, holding_required_f106, holding_satisfied)
       values ('f1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-000000000106',
               'b0000000-0000-4000-8000-000000000001', 'GiWB1FoFaWEY8FgdYTD2yureHfktKvAZgwut4dZf4u1R',
               decode('00', 'hex'), decode('00', 'hex'), now(), 1, 1, true)`
    ),
    /submissions_unique_attempt|duplicate key/
  );
});

await check('a wallet cannot win the same file twice', async () => {
  await assert.rejects(
    db.query(
      `insert into winners (file_id, submission_id, user_id, wallet_address,
                            reward_amount_f106, status, selected_by, approved_by)
       values ('f1060000-0000-4000-8000-000000000107', 'aa000000-0000-4000-8000-000000000001',
               'b0000000-0000-4000-8000-000000000002', '8zaiNx6CLFhHHEfFTN1nAkHWwPHDvKazmMHcbwRtQ8df',
               0.27, 'selected', 'a0000000-0000-4000-8000-000000000001',
               'a0000000-0000-4000-8000-000000000001')`
    ),
    /winners_wallet_per_file|duplicate key/
  );
});

console.log('social verification cannot be faked');

await check('a green check requires a real check timestamp', async () => {
  // Both guards apply here; either one rejecting the row is a pass.
  await assert.rejects(
    db.query(
      `insert into social_verifications (user_id, campaign_id, task_id, method, status, reviewed_by)
       values ('b0000000-0000-4000-8000-000000000001',
               'e0000000-0000-4000-8000-000000000001',
               'e1000000-0000-4000-8000-000000000001', 'manual_review', 'verified',
               'a0000000-0000-4000-8000-000000000001')`
    ),
    /social_verified_needs_check/
  );
});

await check('a manual verification needs a named reviewer', async () => {
  await assert.rejects(
    db.query(
      `insert into social_verifications (user_id, campaign_id, task_id, method, status, checked_at)
       values ('b0000000-0000-4000-8000-000000000001',
               'e0000000-0000-4000-8000-000000000001',
               'e1000000-0000-4000-8000-000000000001', 'manual_review', 'verified', now())`
    ),
    /social_reviewed_needs_reviewer/
  );
});

await check('a reviewed verification is accepted when evidence is complete', async () => {
  await db.query(
    `insert into social_verifications
       (user_id, campaign_id, task_id, method, status, checked_at, reviewed_by, evidence)
     values ('b0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001',
             'e1000000-0000-4000-8000-000000000001','manual_review','verified', now(),
             'a0000000-0000-4000-8000-000000000001','https://x.com/redacted_one')`
  );
  const row = await one(
    `select status from social_verifications where task_id = 'e1000000-0000-4000-8000-000000000001'`
  );
  assert.equal(row.status, 'verified');
});

console.log('payment seals');

await check('a reward cannot be confirmed without a transaction', async () => {
  await assert.rejects(
    db.query(`update rewards set payment_status = 'confirmed' where id = 'ac000000-0000-4000-8000-000000000001'`),
    /rewards_confirmed_requires_tx/
  );
});

await check('a reward amount cannot be edited after approval', async () => {
  await assert.rejects(
    db.query(`update rewards set amount_f106 = 106 where id = 'ac000000-0000-4000-8000-000000000001'`),
    /immutable/
  );
});

await check('a reward cannot be deleted', async () => {
  await assert.rejects(
    db.query(`delete from rewards where id = 'ac000000-0000-4000-8000-000000000001'`),
    /cannot be deleted/
  );
});

await check('a payment transaction is append-only', async () => {
  await db.query(
    `insert into transactions (reward_id, signature, explorer_url, submitted_by)
     values ('ac000000-0000-4000-8000-000000000001',
             '${'5'.repeat(64)}',
             'https://solscan.io/tx/${'5'.repeat(64)}',
             'a0000000-0000-4000-8000-000000000001')`
  );
  await assert.rejects(
    db.query(`update transactions set verification_status = 'verified'`),
    /append-only/
  );
  await assert.rejects(db.query(`delete from transactions`), /append-only/);
});

await check('an audit log row is append-only', async () => {
  await db.query(
    `insert into admin_audit_logs (admin_id, action, entity, entity_id)
     values ('a0000000-0000-4000-8000-000000000001','reward.approve','rewards',
             'ac000000-0000-4000-8000-000000000001')`
  );
  await assert.rejects(
    db.query(`update admin_audit_logs set action = 'tampered'`),
    /append-only/
  );
});

await check('a transaction can confirm exactly one reward', async () => {
  const tx = await one(`select id from transactions limit 1`);
  await db.query(
    `update rewards set payment_status = 'payment_sent' where id = 'ac000000-0000-4000-8000-000000000001'`
  );
  await db.query(
    `update rewards set payment_status = 'confirmed',
        confirmed_transaction_id = $1, confirmed_at = now()
      where id = 'ac000000-0000-4000-8000-000000000001'`,
    [tx.id]
  );
  const row = await one(`select payment_status from rewards where id = 'ac000000-0000-4000-8000-000000000001'`);
  assert.equal(row.payment_status, 'confirmed');
});

await check('a confirmed reward cannot be rolled back or re-linked', async () => {
  await assert.rejects(
    db.query(`update rewards set payment_status = 'awaiting_payment' where id = 'ac000000-0000-4000-8000-000000000001'`),
    /cannot leave the confirmed state/
  );
  await assert.rejects(
    db.query(`update rewards set confirmed_transaction_id = null where id = 'ac000000-0000-4000-8000-000000000001'`),
    /already confirmed/
  );
});

await check('the winners view exposes the verified transaction link', async () => {
  const { rows } = await db.query(`select * from v_public_winners`);
  const row = rows.find((r) => r.file_number === 107);
  assert.equal(row.payment_status, 'confirmed');
  assert.ok(row.signature, 'signature should be published once confirmed');
  assert.ok(row.explorer_url.startsWith('https://solscan.io/tx/'));
});

console.log('answer secrecy');

await check('an answer hash cannot change after the first submission', async () => {
  await assert.rejects(
    db.query(
      `update challenges set answer_hash = 'scrypt$1$1$1$AA$AA'
        where id = 'c1060000-0000-4000-8000-000000000106'`
    ),
    /cannot change after the first submission/
  );
});

await check('no plaintext answer is stored in submissions', async () => {
  const { rows } = await db.query(
    `select answer_ciphertext::text as ct, answer_digest::text as dg from submissions limit 1`
  );
  assert.ok(rows[0].ct.startsWith('\\x'), 'answer should be ciphertext bytes');
  assert.ok(!rows[0].ct.includes('classified'));
  assert.ok(!rows[0].dg.includes('classified'));
});

console.log('formatting and guard rails');

await check('reward amounts keep 8 decimals of precision', async () => {
  const row = await one(`select reward_amount_f106::text as v from files where file_number = 107`);
  assert.equal(row.v, '0.27000000');
});

await check('an invalid wallet address is rejected', async () => {
  await assert.rejects(
    db.query(
      `insert into user_wallets (user_id, address, proof_nonce, proof_message, proof_signature)
       values ('b0000000-0000-4000-8000-000000000001', 'not-a-solana-address', 'n', 'm', 's')`
    ),
    /user_wallets_address_shape/
  );
});

await check('an uppercase email is rejected', async () => {
  await assert.rejects(
    db.query(
      `insert into users (username, email, password_hash)
       values ('newuser', 'Mixed@Case.com', 'x')`
    ),
    /users_email_lowercase/
  );
});

await check('a submission marked eligible without a timestamp is rejected', async () => {
  await assert.rejects(
    db.query(
      `insert into user_campaign_progress (user_id, campaign_id, is_eligible)
       values ('b0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001', true)`
    ),
    /progress_eligible_needs_timestamp/
  );
});

await check('a paused campaign keeps its reward history', async () => {
  await db.query(
    `update partnership_campaigns set status = 'paused', paused_at = now(), paused_reason = 'test'
      where id = 'e0000000-0000-4000-8000-000000000001'`
  );
  const rewards = await one(`select count(*)::int as n from rewards`);
  assert.equal(rewards.n, 1);
});

console.log('the mystery layer');

await check('the investigation tables exist', async () => {
  const { rows } = await db.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`
  );
  const found = new Set(rows.map((r) => r.table_name));
  for (const table of ['story_chapters', 'clues', 'user_clue_discoveries', 'file_unlocks', 'investigation_logs']) {
    assert.ok(found.has(table), `missing table: ${table}`);
  }
});

await check('the clue chain is ordered and acyclic', async () => {
  const clues = (await db.query('select clue_no, requires_clue_no from clues order by clue_no asc')).rows;
  assert.equal(clues.length, 5);
  for (let index = 1; index < clues.length; index += 1) {
    assert.equal(clues[index].requires_clue_no, clues[index - 1].clue_no, 'the chain must be sequential');
  }
});

await check('mystery files are sealed behind a clue and a hashed code', async () => {
  const report = await one(
    `select unlock_requires_clue, unlock_code_hash, is_mystery,
            (unlock_code_hash is not null) as has_unlock_code
       from files where file_number = 42`
  );
  assert.equal(report.is_mystery, true);
  assert.equal(report.has_unlock_code, true);
  assert.ok(String(report.unlock_code_hash).startsWith('scrypt$'), 'the code must be hashed');

  const signal = await one(
    `select unlock_requires_clue, unlock_code_hash, is_mystery
       from files where file_number = 17`
  );
  assert.equal(signal.is_mystery, true);
  assert.equal(signal.unlock_requires_clue, 3);
  assert.ok(String(signal.unlock_code_hash).startsWith('scrypt$'));

  const record = await one(
    `select is_mystery, unlock_code_hash, unlock_requires_clue, lore_body
       from files where file_number = 1`
  );
  assert.equal(record.is_mystery, true);
  assert.equal(record.unlock_code_hash, null, 'the corrupted record opens without a code');
  assert.equal(record.unlock_requires_clue, null);
  assert.ok(String(record.lore_body).includes('[[SYMBOL:1]]'));
  assert.ok(String(record.lore_body).includes('[[REDACT:2]]'));
});

console.log(`\n${passed.length} checks passed\n`);
await db.close();
