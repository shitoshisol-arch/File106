// Process entrypoint: read configuration, connect, serve, and shut down cleanly.

import { loadConfig } from './config.js';
import { createDb, createPgExecutor } from './db.js';
import { createRpcBalanceReader } from './lib/solana.js';
import { createMailer } from './lib/mailer.js';
import { buildServer } from './server.js';

const config = loadConfig();
for (const warning of config.warnings) {
  console.warn(`[config] ${warning}`);
}

const db = createDb(createPgExecutor(config.databaseUrl));
const balanceReader = createRpcBalanceReader(config.solana);
const mailer = createMailer(config);

const app = await buildServer({
  config,
  db,
  balanceReader,
  mailer,
  logger: { level: config.isProduction ? 'info' : 'debug' },
});

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { cluster: config.solana.cluster, mail: mailer.delivered ? 'smtp' : 'log-only' },
    'FILE106 archive terminal online'
  );
  if (!mailer.delivered) {
    app.log.warn('SMTP_URL is not configured: verification links are logged, not emailed');
  }
} catch (error) {
  app.log.error(error, 'failed to start');
  process.exit(1);
}

let closing = false;

// Expired rows are also dropped on read, but a visitor who never comes back
// leaves their row behind. An hourly sweep keeps the table small; a failure is
// logged and the timer stays armed.
const sweep = setInterval(() => {
  app.sessionStore.sweep().catch((error) => {
    app.log.warn({ err: error.message }, 'session sweep failed');
  });
}, 60 * 60 * 1000);
sweep.unref();

async function shutdown(signal) {
  if (closing) return;
  closing = true;
  clearInterval(sweep);
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await db.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
