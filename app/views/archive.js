import { html, raw } from '../lib/html.js';
import { dateLabel, dateTimeLabel, relativeLabel } from '../lib/format.js';
import { page, notice } from './layout.js';

export const STATUS_COPY = {
  draft: { label: 'DRAFT', note: 'Not published. Visible to archivists only.' },
  open: { label: 'OPEN', note: 'Briefing available; submissions are accepted.' },
  locked: { label: 'LOCKED', note: 'A correct answer is in review. No further submissions.' },
  closed: { label: 'CLOSED', note: 'The window has ended. No further submissions.' },
  completed: { label: 'COMPLETED', note: 'Solved, rewarded and archived on-chain.' },
  archived: { label: 'ARCHIVED', note: 'Withdrawn from the public archive.' },
};

const fileNumber = (value) => `FILE ${String(value).padStart(3, '0')}`;

function fileCard(file) {
  return html`<article class="file-card">
    <p class="file-index mono">${fileNumber(file.number)}</p>
    <h3><a href="/archive/${file.slug}">${file.title}</a></h3>
    <p class="file-teaser">${file.teaser}</p>
    <p class="file-meta">
      <span class="status-chip" data-state="${file.status}">${STATUS_COPY[file.status]?.label || file.status}</span>
      <span class="mono">${file.difficulty}</span>
      <span class="mono">${file.reward} F106</span>
    </p>
  </article>`;
}

export function archiveListPage({ session, groups = [], total = 0, message = '' }) {
  const published = groups.filter((group) => group.files.length > 0);

  const body = html`
    <section class="section archive-section">
      <p class="eyebrow">TERMINAL / THE ARCHIVE</p>
      <h1 class="archive-title">FILES IN CUSTODY</h1>
      <p class="lede">
        Each file is a sealed briefing with one answer. The answer exists only as a hash on the
        server; it is not in this page, in the page source, or in any API response.
      </p>

      ${notice('archive', message)}

      ${published.length === 0
        ? html`<div class="archive-pending">
            <p class="eyebrow">NO FILES PUBLISHED YET</p>
            <h2>THE VAULT IS SEALED</h2>
            <p class="fine">
              ${total === 0
                ? 'No file has been published. When an archivist opens one it appears here first.'
                : 'Every file is still in draft. Nothing is shown until an archivist publishes it.'}
            </p>
          </div>`
        : published.map(
            (group) => html`<div class="archive-group">
              <div class="archive-group-head">
                <h2 class="archive-group-title">${group.label}</h2>
                <span class="fine">${group.note}</span>
              </div>
              <div class="file-grid">${group.files.map(fileCard)}</div>
            </div>`
          )}

      <p class="fine">
        One wallet per account. Holding the minimum F106 is checked on-chain by the server at
        submission time, never by the browser.
      </p>
    </section>`;

  return page({ title: 'FILE106 — THE ARCHIVE', body, session });
}

function checkRow(ok, label, detail) {
  return html`<li class="check-item" data-ok="${ok ? 'yes' : 'no'}">
    <span class="check-mark" aria-hidden="true">${ok ? '✓' : '×'}</span>
    <span><strong>${label}</strong> <span class="fine">${detail}</span></span>
  </li>`;
}

function eligibilityPanel({ eligibility, file }) {
  if (file.status !== 'open') {
    return html`<div class="archive-pending">
      <p class="eyebrow">SUBMISSION TERMINAL</p>
      <h2>CLOSED FOR THIS FILE</h2>
      <p class="fine">${STATUS_COPY[file.status]?.note || 'This file is not accepting submissions.'}</p>
    </div>`;
  }

  if (!eligibility.signedIn) {
    return html`<div class="archive-pending">
      <p class="eyebrow">SUBMISSION TERMINAL</p>
      <h2>ACCOUNT REQUIRED</h2>
      <p class="fine">
        A verified account and a linked wallet are required to answer. Nothing is charged to
        register, and linking a wallet signs a message only.
      </p>
      <p class="archive-cta">
        <a class="btn primary" href="/login">SIGN IN</a>
        <a class="btn ghost" href="/register">REGISTER</a>
      </p>
    </div>`;
  }

  const rows = [
    checkRow(true, 'Account verified', 'Signed in with a verified address.'),
    checkRow(
      Boolean(eligibility.wallet),
      'Wallet linked',
      eligibility.wallet ? eligibility.wallet : 'Link a wallet from MY ARCHIVE to prove ownership.'
    ),
  ];

  if (eligibility.wallet) {
    rows.push(
      checkRow(
        eligibility.satisfied,
        `Minimum holding ${file.minHolding} F106`,
        eligibility.balanceError
          ? 'Balance unavailable right now; the holding check is repeated when you submit.'
          : `Balance read from chain: ${eligibility.balance} F106.`
      )
    );
  }

  return html`<div class="wallet-panel">
    <p class="eyebrow">SUBMISSION TERMINAL</p>
    <h2>${eligibility.wallet && eligibility.satisfied ? 'ELIGIBLE' : 'NOT YET ELIGIBLE'}</h2>
    <ul class="checklist">${rows}</ul>
    <p class="fine">
      ${eligibility.wallet
        ? ''
        : html`<a href="/dashboard">Open MY ARCHIVE</a> to link a wallet.`}
    </p>
    <p class="fine">
      The answer box goes live with the submission release. Nothing you type is stored yet, so
      there is nothing here to guess with.
    </p>
  </div>`;
}

export function archiveFilePage({ session, file, eligibility, message = '' }) {
  const status = STATUS_COPY[file.status] || { label: file.status, note: '' };

  const body = html`
    <section class="section archive-section">
      <p class="eyebrow">${fileNumber(file.number)} / ${status.label}</p>
      <h1 class="archive-title">${file.title}</h1>
      <p class="lede">${file.teaser}</p>

      ${notice('archive', message)}

      <div class="stats archive-stats" aria-label="File facts">
        <div class="stat">
          <span class="stat-label">REWARD</span>
          <strong>${file.reward}</strong>
          <span class="stat-note">F106, paid manually after verification</span>
        </div>
        <div class="stat">
          <span class="stat-label">MIN HOLDING</span>
          <strong>${file.minHolding}</strong>
          <span class="stat-note">F106, read on-chain by the server</span>
        </div>
        <div class="stat">
          <span class="stat-label">DIFFICULTY</span>
          <strong>${file.difficulty.toUpperCase()}</strong>
          <span class="stat-note">${file.winnerMethod.replace(/_/g, ' ')}</span>
        </div>
        <div class="stat">
          <span class="stat-label">WINDOW</span>
          <strong>${file.closesAt ? dateLabel(file.closesAt) : 'OPEN-ENDED'}</strong>
          <span class="stat-note">
            ${file.opensAt ? `opened ${dateLabel(file.opensAt)}` : 'no opening date set'}
            ${file.closesAt ? ` · closes ${relativeLabel(file.closesAt)}` : ''}
          </span>
        </div>
      </div>

      ${file.briefing
        ? html`<div class="briefing">
            <p class="eyebrow">BRIEFING</p>
            <div class="briefing-body">${file.briefing}</div>
          </div>`
        : raw('')}

      ${eligibilityPanel({ eligibility, file })}

      <p class="fine">
        ${status.note}
        ${file.opensAt && file.closesAt
          ? ` Window: ${dateTimeLabel(file.opensAt)} — ${dateTimeLabel(file.closesAt)}.`
          : ''}
      </p>
    </section>`;

  return page({ title: `FILE106 — ${file.title}`, body, session });
}
