// Session store backed by the `sessions` table.
//
// @fastify/session v11 talks to a store through four methods: get, set,
// compareAndSet and destroy. The important one is compareAndSet: every session
// carries a generation, and a write is only accepted when the stored generation
// still matches the caller's expectation. That is what prevents a pre-login
// cookie from being promoted into an authenticated session, and what makes the
// "regenerate on sign-in" step atomic rather than hopeful.
//
// Rows are keyed by a SHA-256 of the store id, so a database dump does not hand
// anyone a usable session token. Anonymous sessions are legitimate: a visitor
// needs a CSRF token before an account exists.

import { hashToken } from './tokens.js';

// The plugin exposes the generation through this enumerable key, which means a
// JSON round-trip preserves it. Reading it back through the same key keeps us
// compatible without depending on plugin internals beyond the documented shape.
const METADATA_KEY = '__fastifySessionMetadata';

const UUID = /^[0-9a-f-]{36}$/i;

export function createSessionStore({ db, ttlSeconds, log = console }) {
  const key = (storeId) => hashToken(storeId);

  function generationOf(session, storeId) {
    const generation = session?.[METADATA_KEY]?.generation;
    return typeof generation === 'string' && generation ? generation : storeId;
  }

  function expiryFor(session) {
    const raw = session?.cookie?.expires;
    if (raw) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) return parsed;
    }
    return new Date(Date.now() + ttlSeconds * 1000);
  }

  // Only a real user id may reach the foreign key; an admin session or an
  // anonymous one stays null so the table never claims a wrong owner.
  function principalId(session) {
    const value = session?.userId;
    return typeof value === 'string' && UUID.test(value) ? value : null;
  }

  function revive(row, storeId) {
    const data = row.data && typeof row.data === 'object' ? row.data : {};
    if (data[METADATA_KEY]?.generation !== row.generation) {
      data[METADATA_KEY] = { generation: row.generation };
    }
    return data;
  }

  function enoent() {
    const error = new Error('The session does not exist or has changed');
    error.code = 'ENOENT';
    return error;
  }

  // A store failure happens after the response body is serialized, during the
  // session save, which means Fastify's last-resort serializer answers the
  // client — and it prints the driver message verbatim. Rewriting the error here
  // keeps connection strings, roles and error codes in the log instead of the
  // page, while still failing the request: silently pretending a session was
  // saved would sign people into a phantom.
  function failure(operation, callback) {
    return (error) => {
      log.error?.(`[session] ${operation} failed: ${error.message}`);
      const sanitized = new Error('The archive could not reach its session store. Try again.');
      sanitized.code = 'ESESSIONSTORE';
      sanitized.cause = error;
      callback(sanitized);
    };
  }

  const columns = (session, storeId) => [
    principalId(session),
    JSON.stringify(session),
    generationOf(session, storeId),
    expiryFor(session).toISOString(),
  ];

  return {
    get(storeId, callback) {
      db.one(
        'select data, generation, expires_at from sessions where token_hash = $1 and revoked_at is null',
        [key(storeId)]
      )
        .then((row) => {
          if (!row) return callback(null, null);

          if (new Date(row.expires_at).getTime() <= Date.now()) {
            return db
              .query('delete from sessions where token_hash = $1', [key(storeId)])
              .then(() => callback(null, null))
              .catch(() => callback(null, null));
          }

          return callback(null, revive(row, storeId));
        })
        .catch(failure('read', callback));
    },

    set(storeId, session, callback) {
      db.query(
        `insert into sessions (token_hash, user_id, data, generation, expires_at)
         values ($1, $2, $3::jsonb, $4, $5)
         on conflict (token_hash) do update
            set user_id    = excluded.user_id,
                data       = excluded.data,
                generation = excluded.generation,
                expires_at = excluded.expires_at,
                revoked_at = null`,
        [key(storeId), ...columns(session, storeId)]
      ).then(() => callback(null), failure('create', callback));
    },

    compareAndSet(storeId, expectedGeneration, session, callback) {
      db.one(
        `update sessions
            set user_id    = $3,
                data       = $4::jsonb,
                generation = $5,
                expires_at = $6
          where token_hash = $1
            and generation = $2
            and revoked_at is null
        returning id`,
        [key(storeId), expectedGeneration, ...columns(session, storeId)]
      ).then((row) => callback(row ? null : enoent()), failure('update', callback));
    },

    destroy(storeId, callback) {
      db.query('delete from sessions where token_hash = $1', [key(storeId)]).then(
        () => callback(null),
        failure('delete', callback)
      );
    },

    // Expired rows are dropped opportunistically on read; this keeps the table
    // from accumulating them when a deploy changes the cookie name.
    sweep() {
      return db.query('delete from sessions where expires_at <= now() or revoked_at is not null');
    },
  };
}
