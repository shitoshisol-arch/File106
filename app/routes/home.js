// The home page.
//
// It is still the trust page in site/index.html — one copy, the same file GitHub
// Pages serves. The only per-request substitution is the CSRF token in the
// head, which lets the hidden 8_* symbols on the opening screen ask the server
// to log a discovery. Nothing else changes between visitors.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { csrfToken } from '../lib/csrf.js';
import { HTML } from '../lib/reply.js';

const here = dirname(fileURLToPath(import.meta.url));
const CSRF_MARKER = '<!-- F106_CSRF -->';

export async function homeRoutes(app, { config }) {
  const pagePath = resolve(here, '..', '..', config.trustPageRoot, 'index.html');
  const template = readFileSync(pagePath, 'utf8');

  // The page has one address. The file stays in site/ for GitHub Pages, but a
  // visitor who types the filename lands on the page rather than a copy of it.
  app.get('/index.html', async (request, reply) => reply.code(301).header('location', '/').send());

  app.get('/', async (request, reply) => {
    const token = csrfToken(request.session);
    const body = template.includes(CSRF_MARKER)
      ? template.replace(
          CSRF_MARKER,
          `<meta name="csrf-token" content="${token}">`
        )
      : template;

    return reply
      .code(200)
      .header('cache-control', 'no-store')
      .header('vary', 'cookie')
      .type(HTML)
      .send(body);
  });
}
