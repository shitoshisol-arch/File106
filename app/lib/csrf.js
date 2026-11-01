// CSRF protection bound to the server session.
//
// A per-session token is rendered into every mutating form and also compared
// against an X-CSRF-Token header for JSON calls. Comparing with timingSafeEqual
// keeps the check constant-time, and the token never appears in a URL.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { html } from './html.js';

export function csrfToken(session) {
  if (!session.csrf || typeof session.csrf !== 'string' || session.csrf.length !== 64) {
    session.csrf = randomBytes(32).toString('hex');
  }
  return session.csrf;
}

export function csrfField(session) {
  return html`<input type="hidden" name="csrf" value="${csrfToken(session)}">`;
}

function sameToken(expected, received) {
  if (typeof received !== 'string' || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
}

export function verifyCsrf(session, request) {
  const expected = session?.csrf;
  if (!expected) return false;

  const submitted = request.body?.csrf || request.headers['x-csrf-token'];
  return sameToken(expected, submitted);
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const REJECTED_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>FILE106 — REJECTED</title><link rel="stylesheet" href="/styles.css"></head>' +
  '<body><main class="wrap"><div class="section">' +
  '<p class="eyebrow">ACCESS DENIED</p><h1>REQUEST REJECTED</h1>' +
  '<p>Missing or invalid security token. Reload the page and try again.</p>' +
  '<p><a class="btn ghost" href="/">Return to FILE106</a></p></div></main></body></html>';

// Registered as a preValidation hook: every mutating request is checked before
// it reaches a handler, so no route can forget to call it. It has to run after
// body parsing for <form> submissions, whose token travels in the body.
//
// Two distinct failures are reported separately. A request that carries no
// session at all is simply not signed in — an API caller gets 401 so its client
// can send the visitor to the sign-in page. A request that *has* a session but
// presents the wrong token is a possible forgery and always gets 403.
export function csrfGuard() {
  return async function guard(request, reply) {
    if (!MUTATING.has(request.method)) return;
    if (request.url.startsWith('/api/telegram/webhook')) return;
    if (verifyCsrf(request.session, request)) return;

    const isApi = request.url.startsWith('/api/');
    const noIdentity =
      !request.user && !request.session?.userId && !request.session?.adminId;

    if (isApi && noIdentity) {
      return reply.code(401).send({
        error: 'unauthenticated',
        message: 'Sign in before making this request.',
      });
    }

    if (isApi) {
      return reply.code(403).send({
        error: 'csrf_failed',
        message: 'Missing or invalid security token. Reload the page and try again.',
      });
    }

    return reply.code(403).type('text/html; charset=utf-8').send(REJECTED_HTML);
  };
}
