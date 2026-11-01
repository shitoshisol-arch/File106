import { csrfToken } from '../lib/csrf.js';
import { messageText } from '../lib/validate.js';
import { redirect, sendPage } from '../lib/reply.js';
import { dashboardPage } from '../views/dashboard.js';

function dateLabel(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toISOString().slice(0, 10)} UTC`;
}

export async function dashboardRoutes(app, { db, config, balanceReader }) {
  app.get('/dashboard', async (request, reply) => {
    if (!request.user) return redirect(reply, '/login?notice=login-required');

    const user = request.user;

    const wallet = await db.one(
      `select address, verified_at, first_seen_balance_f106
         from user_wallets
        where user_id = $1 and is_primary = true`,
      [user.id]
    );

    let balance = null;
    let balanceError = '';

    if (wallet) {
      try {
        balance = await balanceReader(wallet.address);
      } catch (error) {
        request.log.warn({ err: error.message }, 'balance read failed on dashboard');
        balanceError = `RPC unreachable · showing the balance captured when the wallet was linked`;
        balance = {
          amount: wallet.first_seen_balance_f106,
          decimals: config.solana.decimals,
        };
      }
    }

    const stats = await db.one(
      `select
         (select count(distinct file_id) from submissions where user_id = $1)::int as files_attempted,
         (select count(*) from submissions where user_id = $1 and status = 'pending_review')::int as pending,
         (select count(*) from winners where user_id = $1 and status = 'approved')::int as wins,
         (select coalesce(sum(amount_f106), 0)::text from rewards
           where user_id = $1 and payment_status = 'confirmed') as confirmed`,
      [user.id]
    );

    return sendPage(
      reply,
      dashboardPage({
        session: request.session,
        user: {
          username: user.username,
          email: user.email,
          status: user.status,
          joinedLabel: dateLabel(user.created_at),
        },
        wallet: wallet
          ? { address: wallet.address, verifiedLabel: dateLabel(wallet.verified_at) }
          : null,
        balance,
        balanceError,
        stats: {
          filesAttempted: stats?.files_attempted ?? 0,
          pending: stats?.pending ?? 0,
          wins: stats?.wins ?? 0,
          confirmedF106: stats?.confirmed ?? '0.00000000',
        },
        csrfToken: csrfToken(request.session),
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });
}
