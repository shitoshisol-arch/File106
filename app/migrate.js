// Applies db/migrations/*.sql in filename order, recording each one so a deploy
// is idempotent. Used by `npm run migrate` on the server and by the deploy step.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { createDb, createPgExecutor } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '..', 'db', 'migrations');

export async function applyMigrations({ db, dir = MIGRATIONS_DIR, log = console }) {
  await db.query(
    `create table if not exists schema_migrations (
       filename   text primary key,
       applied_at timestamptz not null default now()
     )`
  );

  const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const applied = new Set(
    (await db.many('select filename from schema_migrations')).map((row) => row.filename)
  );

  const executed = [];
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(join(dir, file), 'utf8');
    await db.exec(sql);
    await db.query('insert into schema_migrations (filename) values ($1)', [file]);
    executed.push(file);
    log.info?.(`[migrate] applied ${file}`);
  }

  return executed;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('migrate.js');

if (invokedDirectly) {
  const config = loadConfig();
  const db = createDb(createPgExecutor(config.databaseUrl));

  try {
    const executed = await applyMigrations({ db });
    console.log(executed.length ? `applied ${executed.length} migration(s)` : 'already up to date');
  } catch (error) {
    console.error('[migrate] failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
