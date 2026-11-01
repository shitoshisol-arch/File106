import { html, raw } from '../lib/html.js';
import { page, notice } from './layout.js';

const STATUS_LABEL = {
  pending_verification: 'AWAITING VERIFICATION',
  active: 'ACTIVE',
  suspended: 'SUSPENDED',
  deleted: 'CLOSED',
};

function stat(label, value, note) {
  return html`<div class="stat">
    <span class="stat-label">${label}</span>
    <strong>${value}</strong>
    ${note ? html`<span class="stat-note">${note}</span>` : raw('')}
  </div>`;
}

function walletPanel({ wallet, balance, balanceError, csrfToken, refreshable }) {
  if (!wallet) {
    return html`<div class="wallet-panel" id="wallet-panel" data-csrf="${csrfToken}">
      <p class="eyebrow">STEP 2 / WALLET</p>
      <h2>NO WALLET LINKED</h2>
      <p class="fine">
        Link a Solana wallet to prove ownership and read your on-chain F106 balance. Linking
        signs a message only — it never authorises a transaction and moves nothing.
      </p>
      <button class="btn primary" type="button" data-wallet-action="connect">CONNECT WALLET</button>
      <p class="wallet-status" data-wallet-status role="status"></p>
    </div>`;
  }

  return html`<div class="wallet-panel" id="wallet-panel" data-csrf="${csrfToken}" data-address="${wallet.address}">
    <p class="eyebrow">STEP 2 / WALLET</p>
    <h2>WALLET VERIFIED</h2>
    <p class="wallet-address mono break">${wallet.address}</p>
    <p class="fine">
      Ownership proven by a signed message on ${wallet.verifiedLabel}. Balances are read on-chain
      by the server; the browser value is never trusted.
    </p>

    <div class="balance-block">
      <span class="stat-label">F106 BALANCE</span>
      <strong class="balance-value">${balanceError ? 'UNAVAILABLE' : balance.amount}</strong>
      <span class="stat-note">
        ${balanceError
          ? balanceError
          : `${balance.decimals} decimals · verified against the official mint`}
      </span>
    </div>

    ${refreshable
      ? html`<button class="btn ghost" type="button" data-wallet-action="refresh">REFRESH BALANCE</button>`
      : raw('')}
    <p class="wallet-status" data-wallet-status role="status"></p>
  </div>`;
}

export function dashboardPage({
  session,
  user,
  wallet,
  balance = null,
  balanceError = '',
  stats = {},
  csrfToken,
  message = '',
}) {
  const body = html`
    <section class="section archive-section">
      <p class="eyebrow">TERMINAL / MY ARCHIVE</p>
      <h1 class="archive-title">${user.username}</h1>
      <p class="lede">
        Account status: <span class="mono">${STATUS_LABEL[user.status] || user.status}</span> ·
        ${user.email} · joined ${user.joinedLabel}
      </p>

      ${notice('form', message)}

      ${walletPanel({ wallet, balance, balanceError, csrfToken, refreshable: Boolean(wallet) })}

      <div class="stats archive-stats" aria-label="Participation">
        ${stat('FILES ATTEMPTED', stats.filesAttempted ?? 0, 'Distinct files')}
        ${stat('PENDING REVIEW', stats.pending ?? 0, 'Awaiting an archivist')}
        ${stat('WINS', stats.wins ?? 0, 'Approved answers')}
        ${stat('CONFIRMED F106', stats.confirmedF106 ?? '0.00000000', 'Paid and verified on Solana')}
      </div>

      <div class="archive-pending">
        <p class="eyebrow">THE ARCHIVE</p>
        <h2>FILES IN CUSTODY</h2>
        <p class="fine">
          Every published file is listed in the archive. Answers are checked against a hash the
          server holds, so this page never reports a number it cannot prove.
        </p>
        <p><a class="btn primary" href="/archive">ENTER THE ARCHIVE</a></p>
      </div>
    </section>`;

  return page({
    title: `FILE106 — ${user.username}`,
    body,
    session,
    signedIn: true,
    signedInName: user.username,
    scripts: ['/archive.js'],
  });
}
