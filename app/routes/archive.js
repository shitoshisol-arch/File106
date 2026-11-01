// Public archive: the file list and one file page.
//
// Two rules hold on every path here. Drafts and archived files are invisible, so
// a URL cannot leak something an archivist has not published. And no query in
// this file selects `challenges` at all: the answer is not merely withheld from
// the template, it is never fetched, so it cannot reach a buffer that is
// serialised to the browser.

import { parseUnits } from '../lib/solana.js';
import { messageText } from '../lib/validate.js';
import { sendPage } from '../lib/reply.js';
import { archiveFilePage, archiveListPage } from '../views/archive.js';

// Anything not listed here is not public. 'draft' and 'archived' are absent on
// purpose, so the default for a new status is invisible rather than exposed.
const PUBLIC_STATUSES = ['open', 'locked', 'closed', 'completed'];

const GROUPS = [
  { key: 'open', label: 'OPEN', note: 'Accepting answers', statuses: ['open'] },
  { key: 'locked', label: 'LOCKED', note: 'An answer is under review', statuses: ['locked'] },
  { key: 'closed', label: 'CLOSED', note: 'The window has ended', statuses: ['closed'] },
  { key: 'completed', label: 'COMPLETED', note: 'Solved and rewarded', statuses: ['completed'] },
];

const SLUG = /^[a-z0-9-]{1,80}$/;

function summarise(row) {
  return {
    number: row.file_number,
    slug: row.slug,
    title: row.title,
    teaser: row.teaser,
    difficulty: row.difficulty,
    status: row.status,
    reward: row.reward,
  };
}

export async function archiveRoutes(app, { db, config, balanceReader }) {
  app.get('/archive', async (request, reply) => {
    const rows = await db.many(
      `select file_number, slug, title, teaser, difficulty, status,
              reward_amount_f106::text as reward
         from files
        where is_enabled and status = any($1::text[])
        order by file_number asc`,
      [PUBLIC_STATUSES]
    );

    // Counted separately so the empty state can say "nothing published" rather
    // than "nothing exists" — the difference matters to whoever just installed
    // the archive and wonders whether their work was saved.
    const total = await db.value('select count(*)::int as v from files');

    const groups = GROUPS.map((group) => ({
      ...group,
      files: rows.filter((row) => group.statuses.includes(row.status)).map(summarise),
    }));

    return sendPage(
      reply,
      archiveListPage({
        session: request.session,
        groups,
        total,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.get('/archive/:slug', async (request, reply) => {
    const slug = String(request.params.slug ?? '');
    // Rejected before the query: an unshaped slug cannot be a record, and this
    // keeps the index lookup to one shape.
    if (!SLUG.test(slug)) return reply.callNotFound();

    const file = await db.one(
      `select file_number, slug, title, teaser, briefing, difficulty, status,
              reward_amount_f106::text as reward,
              min_holding_f106::text  as min_holding,
              winner_method, max_winners, opens_at, closes_at
         from files
        where slug = $1 and is_enabled and status = any($2::text[])`,
      [slug, PUBLIC_STATUSES]
    );

    if (!file) return reply.callNotFound();

    const view = {
      number: file.file_number,
      slug: file.slug,
      title: file.title,
      teaser: file.teaser,
      briefing: file.briefing ?? '',
      difficulty: file.difficulty,
      status: file.status,
      reward: file.reward,
      minHolding: file.min_holding,
      winnerMethod: file.winner_method,
      maxWinners: file.max_winners,
      opensAt: file.opens_at,
      closesAt: file.closes_at,
    };

    const eligibility = {
      signedIn: Boolean(request.user),
      wallet: '',
      balance: '',
      balanceError: '',
      satisfied: false,
    };

    if (request.user) {
      const wallet = await db.one(
        'select address from user_wallets where user_id = $1 and is_primary = true',
        [request.user.id]
      );

      if (wallet) {
        eligibility.wallet = wallet.address;
        try {
          const balance = await balanceReader(wallet.address);
          eligibility.balance = balance.amount;
          // The holding rule compares base units, so a 1.00000001 balance
          // satisfies a 1 F106 file without any float rounding in between.
          eligibility.satisfied = balance.baseUnits >= parseUnits(file.min_holding, config.solana.decimals);
        } catch (error) {
          request.log.warn({ err: error.message }, 'balance read failed on file page');
          eligibility.balanceError = 'unavailable';
        }
      }
    }

    return sendPage(
      reply,
      archiveFilePage({
        session: request.session,
        file: view,
        eligibility,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });
}
