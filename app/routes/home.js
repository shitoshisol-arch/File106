// The home page.
//
// It is still the trust page in site/index.html — one copy, the same file GitHub
// Pages serves — with one region rendered per request: the reward gate. The
// file is read once at boot and the marker inside it is replaced, so the static
// page stays valid on its own and this route stays a string substitution rather
// than a second copy of 360 lines of marketing copy that would drift.
//
// The response is no-store and varies on the cookie. That is not a nicety: the
// gate names the visitor's own holding, so a cached copy would eventually show
// one participant another participant's balance.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render } from '../lib/html.js';
import { HTML } from '../lib/reply.js';
import { parseUnits } from '../lib/solana.js';
import { HOME_GATE_MARKER, renderHomeGate } from '../views/homeGate.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function homeRoutes(app, { db, config, balanceReader }) {
  const pagePath = resolve(here, '..', '..', config.trustPageRoot, 'index.html');
  const template = readFileSync(pagePath, 'utf8');
  const marked = template.includes(HOME_GATE_MARKER);

  if (!marked) {
    // Not fatal: the page still renders, the gate just lands where a human can
    // find it. Saying so once at boot beats a silently missing gate.
    app.log.warn(
      { page: pagePath, marker: HOME_GATE_MARKER },
      'home page has no gate marker — the reward gate will be appended to <main>'
    );
  }

  // The page has one address. The file stays in site/ for GitHub Pages, but a
  // visitor who types the filename lands on the gate rather than a copy of the
  // page with an unrendered marker in it.
  app.get('/index.html', async (request, reply) => reply.code(301).header('location', '/').send());

  app.get('/', async (request, reply) => {
    // The cheapest gate across every open file, and everything it is offering.
    // Drafts are excluded here for the same reason the archive excludes them.
    const totals = await db.one(
      `select count(*)::int                                as open,
              coalesce(sum(reward_amount_f106), 0)::text    as on_offer,
              coalesce(min(min_holding_f106), 0)::text      as gate
         from files
        where is_enabled and status = 'open'`
    );

    let state = 'anonymous';
    let username = '';
    let balance = '';

    if (totals.open === 0) {
      state = 'sealed';
    } else if (request.user) {
      const wallet = await db.one(
        'select address from user_wallets where user_id = $1 and is_primary = true',
        [request.user.id]
      );

      if (!wallet) {
        state = 'no-wallet';
        username = request.user.username;
      } else {
        try {
          const reading = await balanceReader(wallet.address);
          balance = reading.amount;
          // Base units, exactly like the file page and the submission gate, so
          // the home page cannot disagree with what the terminal will decide.
          const required = parseUnits(totals.gate, config.solana.decimals);
          state = reading.baseUnits >= required ? 'eligible' : 'below';
        } catch (error) {
          request.log.warn({ err: error.message }, 'balance read failed on the reward gate');
          state = 'unavailable';
        }
      }
    }

    const gate = render(
      renderHomeGate({
        open: totals.open,
        onOffer: totals.on_offer,
        gate: totals.gate,
        state,
        username,
        balance,
      })
    );

    const body = marked
      ? template.replace(HOME_GATE_MARKER, gate)
      : template.replace('</main>', `${gate}</main>`);

    return reply
      .code(200)
      .header('cache-control', 'no-store')
      .header('vary', 'cookie')
      .type(HTML)
      .send(body);
  });
}
