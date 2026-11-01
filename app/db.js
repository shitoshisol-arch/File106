// One thin data layer that speaks to both node-postgres (production) and an
// embedded Postgres engine (tests). Anything with a query(text, params) method
// returning { rows } is a valid executor, which is what makes the whole request
// path testable without a database server.

import pg from 'pg';

export function createPgExecutor(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (error) => {
    console.error('[db] idle client error', error.message);
  });

  return {
    query: (text, params) => pool.query(text, params),
    connect: () => pool.connect(),
    close: () => pool.end(),
  };
}

export function createDb(executor) {
  const query = (text, params) => executor.query(text, params);

  const api = {
    raw: executor,
    query,

    async many(text, params) {
      const { rows } = await executor.query(text, params);
      return rows;
    },

    async one(text, params) {
      const { rows } = await executor.query(text, params);
      return rows[0] ?? null;
    },

    async value(text, params, column = 'v') {
      const row = await api.one(text, params);
      return row ? row[column] : null;
    },

    // Multi-statement scripts (migrations). Postgres uses the simple protocol
    // for a parameterless query, and embedded Postgres exposes exec().
    async exec(text) {
      if (typeof executor.exec === 'function') {
        await executor.exec(text);
        return;
      }
      await executor.query(text);
    },

    // Runs fn inside BEGIN/COMMIT. With a pool it pins a client so the whole
    // block uses one connection; a single-connection executor (embedded
    // Postgres) needs no pinning.
    async transaction(fn) {
      if (typeof executor.connect === 'function') {
        const client = await executor.connect();
        const scoped = createDb({ query: (text, params) => client.query(text, params) });
        try {
          await client.query('begin');
          const result = await fn(scoped);
          await client.query('commit');
          return result;
        } catch (error) {
          await client.query('rollback').catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      }

      await query('begin');
      try {
        const result = await fn(api);
        await query('commit');
        return result;
      } catch (error) {
        await query('rollback').catch(() => {});
        throw error;
      }
    },

    close: () => (typeof executor.close === 'function' ? executor.close() : Promise.resolve()),
  };

  return api;
}
