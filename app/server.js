// Wires plugins, session state, the CSRF gate and the routes together.
// buildServer() takes every external dependency as an argument so tests can run
// the exact production code path against an embedded database and a stubbed RPC.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';

import { createSessionStore } from './lib/session-store.js';
import { createUploadStore } from './lib/uploads.js';
import { csrfGuard } from './lib/csrf.js';
import { HTML } from './lib/reply.js';
import { authRoutes } from './routes/auth.js';
import { homeRoutes } from './routes/home.js';
import { walletRoutes } from './routes/wallet.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { archiveRoutes } from './routes/archive.js';
import { investigateRoutes } from './routes/investigate.js';
import { adminRoutes } from './routes/admin.js';

const here = dirname(fileURLToPath(import.meta.url));

const NOT_FOUND_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FILE106 — FILE NOT FOUND</title><link rel="stylesheet" href="/styles.css"></head>
<body><main class="wrap"><div class="section"><p class="eyebrow">404</p>
<h1>NO SUCH RECORD</h1><p>The archive holds no file at this address.</p>
<p><a class="btn ghost" href="/">Return to FILE106</a></p></div></main></body></html>`;

const SERVER_ERROR_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FILE106 — INTERNAL ERROR</title><link rel="stylesheet" href="/styles.css"></head>
<body><main class="wrap"><div class="section"><p class="eyebrow">500</p>
<h1>TRANSMISSION INTERRUPTED</h1><p>The archive logged this fault. Nothing was charged and no funds moved.</p>
<p><a class="btn ghost" href="/">Return to FILE106</a></p></div></main></body></html>`;

export async function buildServer({ config, db, balanceReader, mailer, transactionVerifier = null, logger = false }) {
  const app = Fastify({
    logger: logger || false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);

  // Sessions are persisted, so a restart does not sign anyone out and a single
  // deleted row revokes a session outright.
  //
  // saveUninitialized is off and rolling is off on purpose. A session row is
  // written only when the session actually changes (a CSRF token is minted, an
  // account signs in, a wallet is linked), so static assets and repeat page
  // views cost no database writes. The trade-off is an absolute lifetime of
  // SESSION_TTL_HOURS from the last change rather than an idle timer; for an
  // archive that people visit in sessions, a fixed expiry is the safer rule.
  const sessionStore = createSessionStore({
    db,
    ttlSeconds: config.sessionTtlHours * 3600,
    log: app.log,
  });

  await app.register(session, {
    secret: config.sessionSecret,
    store: sessionStore,
    cookieName: 'f106_archive',
    saveUninitialized: false,
    rolling: false,
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: config.sessionTtlHours * 3600,
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'https://gateway.pinata.cloud', 'https://i.ibb.co', 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        // Only a local preview may be framed, and only when asked for: the
        // deployed archive refuses framing so a clickjacked page cannot trick
        // a signed-in archivist into pressing a button that seals an answer.
        frameAncestors: config.allowPreviewFraming ? null : ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    // The CSP already refuses framing; this keeps the legacy header honest for
    // browsers that ignore frame-ancestors.
    xFrameOptions: config.allowPreviewFraming ? false : { action: 'deny' },
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    allowList: (request) => request.url === '/healthz',
  });

  await app.register(formbody);

  // The trust page and its assets are the same files GitHub Pages serves today,
  // so there is exactly one copy of the public site. `index` is off so `/`
  // belongs to homeRoutes and everything else here stays a plain static asset.
  await app.register(fastifyStatic, {
    root: resolve(here, '..', config.trustPageRoot),
    prefix: '/',
    index: false,
    cacheControl: true,
    maxAge: '1h',
  });

  app.decorateRequest('user', null);
  // A session belongs to one principal, so an archivist request has `admin` set
  // and `user` null. Both are resolved once, before any handler runs.
  app.decorateRequest('admin', null);

  app.addHook('onRequest', async (request) => {
    const adminId = request.session?.adminId;
    if (adminId) {
      const admin = await db.one(
        'select id, email, display_name, role, is_active from admin_users where id = $1',
        [adminId]
      );

      if (!admin || !admin.is_active) {
        delete request.session.adminId;
      } else {
        request.admin = admin;
      }
    }

    const userId = request.session?.userId;
    if (!userId) return;

    const user = await db.one(
      'select id, username, email, status, created_at from users where id = $1',
      [userId]
    );

    if (!user || user.status === 'deleted' || user.status === 'suspended') {
      delete request.session.userId;
      return;
    }

    request.user = user;
  });

  // preValidation, not onRequest: the token may arrive in a form body, which is
  // only parsed just before this stage. Running earlier would reject every
  // HTML form that is not carrying a header.
  app.addHook('preValidation', csrfGuard());

  // Error and not-found handlers are registered before the routes: a handler
  // set afterwards is not inherited by already-registered contexts, and the
  // default one happily echoes database error codes to the browser.
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.code(404).type(HTML).send(NOT_FOUND_HTML);
  });

  app.setErrorHandler((error, request, reply) => {
    const status = Number(error.statusCode) || 500;

    if (status < 500) {
      return reply.code(status).send({ error: error.code || 'bad_request', message: error.message });
    }

    // The detail goes to the log, never to the visitor: driver messages can name
    // tables, users, and error codes that are of no use to anyone but an attacker.
    request.log.error({ err: error }, 'unhandled request error');
    return reply.code(500).type(HTML).send(SERVER_ERROR_HTML);
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  // Exposed so the process can drop expired rows on a timer rather than waiting
  // for someone to visit with a stale cookie.
  app.decorate('sessionStore', sessionStore);

  await app.register(homeRoutes, { db, config, balanceReader });
  await app.register(authRoutes, { db, config, mailer });
  await app.register(walletRoutes, { db, config, balanceReader });
  await app.register(dashboardRoutes, { db, config, balanceReader });
  await app.register(archiveRoutes, { db, config, balanceReader });
  await app.register(investigateRoutes, { db, config });

  // Uploads are written outside the served directory, so this store is the only
  // way any of them can be read back.
  const uploads = createUploadStore(config.uploads);
  await app.register(adminRoutes, { db, config, uploads, balanceReader, transactionVerifier });

  return app;
}
