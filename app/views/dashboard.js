import { html, raw } from '../lib/html.js';
import { dateLabel, dateTimeLabel } from '../lib/format.js';
import { clueLabel, fileLabel, renderDocument } from '../lib/mystery.js';
import { page, notice } from './layout.js';

const STATUS_LABEL = {
  pending_verification: 'AWAITING VERIFICATION',
  active: 'ACTIVE',
  suspended: 'SUSPENDED',
  deleted: 'CLOSED',
};

const SUBMISSION_LABEL = {
  pending_review: 'PENDING REVIEW',
  correct: 'CORRECT',
  incorrect: 'INCORRECT',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  rewarded: 'REWARDED',
};

const REWARD_LABEL = {
  awaiting_payment: 'AWAITING MANUAL PAYMENT',
  payment_sent: 'PAYMENT SENT / VERIFYING',
  confirmed: 'CONFIRMED ON-CHAIN',
  rejected: 'REJECTED',
};

function stat(label, value, note) {
  return html`<div class="stat">
    <span class="stat-label">${label}</span>
    <strong>${value}</strong>
    ${note ? html`<span class="stat-note">${note}</span>` : raw('')}
  </div>`;
}

function progressBar(percent) {
  return html`<div class="progress">
    <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
         aria-valuenow="${percent}" aria-label="Investigation progress">
      <span class="progress-fill" style="width: ${percent}%"></span>
    </div>
    <p class="progress-label mono">${percent}% OF THE ARCHIVE RECOVERED</p>
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
          : `${balance.decimals} decimals — verified against the official mint`}
      </span>
    </div>

    ${refreshable
      ? html`<button class="btn ghost" type="button" data-wallet-action="refresh">REFRESH BALANCE</button>`
      : raw('')}
    <p class="wallet-status" data-wallet-status role="status"></p>
  </div>`;
}

function clueCards(discoveries) {
  if (discoveries.length === 0) {
    return html`<p class="fine">
      No signals decoded yet. Look for the 8_* glyph and blacked-out passages on the homepage,
      the investigation terminal and recovered documents.
    </p>`;
  }

  return html`<div class="clue-grid">
    ${discoveries.map(
      (row) => html`<article class="clue-card">
        <p class="file-index mono">${clueLabel(row.clue_no)} / DECODED</p>
        <h3>${row.title}</h3>
        ${renderDocument(row.body)}
        <p class="fine mono">${dateTimeLabel(row.discovered_at)}${row.location ? ` / ${row.location}` : ''}</p>
      </article>`
    )}
  </div>`;
}

function unlockedList(unlocks) {
  if (unlocks.length === 0) {
    return html`<p class="fine">No files recovered yet. <a href="/archive">Open the archive</a>.</p>`;
  }

  return html`<ul class="evidence-list">
    ${unlocks.map(
      (row) => html`<li class="evidence-row">
        <span class="mono">${fileLabel(row.file_number)}</span>
        <span><a href="/archive/${row.slug}">${row.title}</a></span>
        <span class="mono status-chip" data-state="open">${String(row.unlock_method).toUpperCase()}</span>
      </li>`
    )}
  </ul>`;
}

function submissionsTable(submissions) {
  if (submissions.length === 0) {
    return html`<p class="fine">No answers submitted. A solved file becomes a claim only after review.</p>`;
  }

  return html`<table class="admin-table">
    <thead><tr><th>File</th><th>Status</th><th>Submitted</th><th>Holding</th><th>Note</th></tr></thead>
    <tbody>
      ${submissions.map(
        (row) => html`<tr>
          <td><a href="/archive/${row.slug}">${fileLabel(row.file_number)} ${row.title}</a></td>
          <td><span class="status-chip" data-state="${row.status}">${SUBMISSION_LABEL[row.status] || row.status}</span></td>
          <td class="mono">${dateTimeLabel(row.submitted_at)}</td>
          <td class="mono">${row.holding_snapshot} F106</td>
          <td class="fine">${row.admin_note || (row.reviewed_at ? `Reviewed ${dateLabel(row.reviewed_at)}` : '—')}</td>
        </tr>`
      )}
    </tbody>
  </table>`;
}

function rewardsTable(rewards) {
  if (rewards.length === 0) {
    return html`<p class="fine">No reward claims yet.</p>`;
  }

  return html`<table class="admin-table">
    <thead><tr><th>Reward</th><th>File</th><th>Amount</th><th>Status</th><th>Transaction</th></tr></thead>
    <tbody>
      ${rewards.map(
        (row) => html`<tr>
          <td class="mono">#${row.reward_no}</td>
          <td>${fileLabel(row.file_number)} ${row.title}</td>
          <td class="mono">${row.amount} F106</td>
          <td><span class="status-chip" data-state="${row.payment_status}">${REWARD_LABEL[row.payment_status] || row.payment_status}</span></td>
          <td class="mono">
            ${row.signature
              ? html`<a href="${row.explorer_url}" target="_blank" rel="noopener noreferrer">${String(row.signature).slice(0, 12)}…</a>`
              : '—'}
          </td>
        </tr>`
      )}
    </tbody>
  </table>`;
}

function timeline(logs) {
  if (logs.length === 0) return html`<p class="fine">Nothing logged yet.</p>`;
  return html`<ol class="timeline">
    ${logs.map(
      (row) => html`<li>
        <span class="mono">${dateTimeLabel(row.created_at)}</span>
        <span>${row.message}</span>
      </li>`
    )}
  </ol>`;
}

export function dashboardPage({
  session,
  user,
  wallet,
  balance = null,
  balanceError = '',
  stats = {},
  investigation = null,
  csrfToken,
  message = '',
}) {
  const log = investigation ?? {
    percent: 0,
    cluesFound: 0,
    cluesTotal: 0,
    filesUnlocked: 0,
    filesTotal: 0,
    puzzlesSolved: 0,
    puzzlesTotal: 0,
    pending: 0,
    wins: 0,
    confirmedF106: '0.00000000',
    discoveries: [],
    unlocks: [],
    submissions: [],
    rewards: [],
    logs: [],
  };

  const body = html`
    <section class="section archive-section investigate-section">
      <p class="eyebrow">TERMINAL / MY INVESTIGATION</p>
      <h1 class="archive-title">${user.username}</h1>
      <p class="lede">
        Account status: <span class="mono">${STATUS_LABEL[user.status] || user.status}</span> —
        ${user.email} — joined ${user.joinedLabel}
      </p>

      ${notice('form', message)}

      ${walletPanel({ wallet, balance, balanceError, csrfToken, refreshable: Boolean(wallet) })}

      ${progressBar(log.percent)}

      <div class="stats archive-stats" aria-label="Investigation progress">
        ${stat('CLUES', `${log.cluesFound}/${log.cluesTotal}`, 'Signals decoded')}
        ${stat('FILES', `${log.filesUnlocked}/${log.filesTotal}`, 'Records recovered')}
        ${stat('PUZZLES', `${log.puzzlesSolved}/${log.puzzlesTotal}`, 'Accepted answers')}
        ${stat('CLAIMS', log.pending, `${log.wins} approved / ${log.confirmedF106} F106 confirmed`)}
      </div>

      <div class="archive-pending">
        <p class="eyebrow">NEXT MOVE</p>
        <h2>THE INVESTIGATION IS STILL OPEN</h2>
        <p class="fine">
          Every file with a reward is paid manually after an archivist verifies the answer and the
          on-chain transfer. Nothing is paid automatically, and a duplicate claim is refused by
          the database rather than by a browser check.
        </p>
        <p class="archive-cta">
          <a class="btn primary" href="/investigate">OPEN THE INVESTIGATION</a>
          <a class="btn ghost" href="/archive">FILES IN CUSTODY</a>
        </p>
      </div>

      <div class="archive-group">
        <div class="archive-group-head">
          <h2 class="archive-group-title">CLUES RECOVERED</h2>
          <span class="fine">${log.cluesFound} of ${log.cluesTotal}</span>
        </div>
        ${clueCards(log.discoveries)}
      </div>

      <div class="archive-group">
        <div class="archive-group-head">
          <h2 class="archive-group-title">FILES RECOVERED</h2>
          <span class="fine">${log.filesUnlocked} opened</span>
        </div>
        ${unlockedList(log.unlocks)}
      </div>

      <div class="archive-group">
        <div class="archive-group-head">
          <h2 class="archive-group-title">SUBMITTED CLAIMS</h2>
          <span class="fine">${log.pending} awaiting review</span>
        </div>
        ${submissionsTable(log.submissions)}
      </div>

      <div class="archive-group">
        <div class="archive-group-head">
          <h2 class="archive-group-title">REWARDS</h2>
          <span class="fine">Manual payout, verified transaction</span>
        </div>
        ${rewardsTable(log.rewards)}
      </div>

      <div class="archive-group">
        <div class="archive-group-head">
          <h2 class="archive-group-title">INVESTIGATION TIMELINE</h2>
          <span class="fine">Server-recorded events</span>
        </div>
        ${timeline(log.logs)}
      </div>
    </section>`;

  return page({
    title: `FILE106 — ${user.username}`,
    body,
    session,
    signedIn: true,
    signedInName: user.username,
    scripts: ['/archive.js', '/mystery.js'],
  });
}
