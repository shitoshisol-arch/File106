import { html, raw } from '../lib/html.js';
import { dateTimeLabel } from '../lib/format.js';
import { CHAPTER_STATUSES } from '../lib/validate.js';
import { adminShell, selectField, stat, textArea, textField } from './admin.js';
import { errorList, notice, page } from './layout.js';

const STATUS_LABEL = {
  pending_review: 'PENDING REVIEW',
  correct: 'CORRECT / AWAITING REVIEW',
  incorrect: 'INCORRECT',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  rewarded: 'REWARDED',
};

const PAYMENT_LABEL = {
  awaiting_payment: 'AWAITING MANUAL PAYMENT',
  payment_sent: 'PAYMENT SENT / VERIFYING',
  confirmed: 'CONFIRMED ON-CHAIN',
  rejected: 'REJECTED',
};

const VERIFICATION_LABEL = {
  pending: 'PENDING',
  verified: 'VERIFIED',
  failed: 'FAILED',
};

const CHAPTER_STATUS_LABEL = {
  draft: 'DRAFT',
  published: 'PUBLISHED',
  archived: 'ARCHIVED',
};

function checkbox({ name, label, checked = false, hint = '' }) {
  return html`<label class="field field-check">
    <input type="checkbox" name="${name}" value="1" ${checked ? raw('checked') : raw('')}>
    <span>${label}</span>
    ${hint ? html`<span class="field-hint">${hint}</span>` : raw('')}
  </label>`;
}

function adminResult(admin, active, title, body) {
  return page({
    title: `FILE106 — ${title}`,
    body: adminShell({ admin, active, body }),
    session: { csrf: admin.csrf },
    nav: html`<a href="/archive">VIEW ARCHIVE</a>`,
    terminalLabel: 'ARCHIVIST',
  });
}

export function adminChaptersPage({ admin, chapters = [], message = '' }) {
  const body = html`
    <h1 class="archive-title">STORY CHAPTERS</h1>
    ${notice('admin', message)}
    <p class="fine">
      A chapter decrypts only when the participant has recovered enough clues and, if set, opened
      the required file. Drafts are invisible.
    </p>
    <p class="archive-cta"><a class="btn primary" href="/admin/chapters/new">NEW CHAPTER</a></p>

    ${chapters.length === 0
      ? html`<div class="archive-pending">
          <p class="eyebrow">NO CHAPTERS</p>
          <h2>NOTHING WRITTEN YET</h2>
          <p class="fine">Add chapter 01 to open the investigation.</p>
        </div>`
      : html`<table class="admin-table">
          <thead><tr><th>№</th><th>Chapter</th><th>Status</th><th>Requires</th><th>Updated</th></tr></thead>
          <tbody>
            ${chapters.map(
              (chapter) => html`<tr>
                <td class="mono">${String(chapter.chapter_no).padStart(2, '0')}</td>
                <td>
                  <a href="/admin/chapters/${chapter.id}">${chapter.title}</a>
                  <span class="fine mono"> / ${chapter.slug}</span>
                </td>
                <td><span class="status-chip" data-state="${chapter.status}">${CHAPTER_STATUS_LABEL[chapter.status] || chapter.status}</span></td>
                <td class="fine">
                  ${Number(chapter.required_clue_count) || 0} clue(s)
                  ${chapter.required_file_number ? ` · FILE ${String(chapter.required_file_number).padStart(3, '0')}` : ''}
                </td>
                <td class="mono">${dateTimeLabel(chapter.updated_at)}</td>
              </tr>`
            )}
          </tbody>
        </table>`}`;

  return adminResult(admin, 'chapters', 'STORY CHAPTERS', body);
}

export function adminChapterEditorPage({ admin, chapter = null, errors = {}, values = {}, message = '' }) {
  const isNew = !chapter;
  const action = isNew ? '/admin/chapters' : `/admin/chapters/${chapter.id}`;

  const body = html`
    <h1 class="archive-title">${isNew ? 'NEW CHAPTER' : `EDIT CHAPTER ${String(chapter.chapter_no).padStart(2, '0')}`}</h1>
    ${notice('admin', message)}
    ${errorList(errors)}

    <form method="post" action="${action}" class="admin-form">
      ${html`<input type="hidden" name="csrf" value="${admin.csrf}">`}
      <div class="field-row">
        ${textField({ name: 'chapterNo', label: 'CHAPTER NUMBER', type: 'number', value: values.chapterNo ?? '' })}
        ${textField({ name: 'slug', label: 'SLUG', value: values.slug ?? '', required: false, hint: 'Blank means chapter-<number>.' })}
      </div>
      ${textField({ name: 'eyebrow', label: 'EYEBROW', value: values.eyebrow ?? '', required: false })}
      ${textField({ name: 'title', label: 'TITLE', value: values.title ?? '' })}
      ${textArea({ name: 'summary', label: 'SUMMARY', value: values.summary ?? '', rows: 2, hint: 'Shown on the chapter card.' })}
      ${textArea({ name: 'body', label: 'CHAPTER TEXT', value: values.body ?? '', rows: 16, hint: 'Use [[SYMBOL:1]] and [[REDACT:2]] to place hidden clues.' })}

      <div class="field-row">
        ${textField({ name: 'requiredClueCount', label: 'REQUIRED CLUES', type: 'number', value: values.requiredClueCount ?? 0, hint: '0 means the chapter is readable immediately.' })}
        ${textField({ name: 'requiredFileNumber', label: 'REQUIRED FILE NUMBER', type: 'number', value: values.requiredFileNumber ?? '', required: false })}
        ${selectField({ name: 'status', label: 'STATUS', options: CHAPTER_STATUSES, value: values.status ?? 'draft' })}
      </div>

      <button class="btn primary" type="submit">${isNew ? 'CREATE CHAPTER' : 'SAVE CHAPTER'}</button>
    </form>

    <p class="archive-cta"><a class="btn ghost" href="/admin/chapters">ALL CHAPTERS</a></p>`;

  return adminResult(admin, 'chapters', isNew ? 'NEW CHAPTER' : `EDIT ${chapter.title}`, body);
}

export function adminCluesPage({ admin, clues = [], message = '' }) {
  const body = html`
    <h1 class="archive-title">CLUES</h1>
    ${notice('admin', message)}
    <p class="fine">
      A clue is revealed only when its number is clicked and its prerequisite has already been
      recovered. The clue text is never placed in a page until the server checks that.
    </p>
    <p class="archive-cta"><a class="btn primary" href="/admin/clues/new">NEW CLUE</a></p>

    ${clues.length === 0
      ? html`<div class="archive-pending">
          <p class="eyebrow">NO CLUES</p>
          <h2>NO SIGNALS IN THE ARCHIVE</h2>
          <p class="fine">Add a clue, then place [[SYMBOL:n]] or [[REDACT:n]] in a document.</p>
        </div>`
      : html`<table class="admin-table">
          <thead><tr><th>№</th><th>Clue</th><th>Location</th><th>Chain</th><th>Enabled</th><th>Updated</th></tr></thead>
          <tbody>
            ${clues.map(
              (clue) => html`<tr>
                <td class="mono">${String(clue.clue_no).padStart(3, '0')}</td>
                <td><a href="/admin/clues/${clue.id}">${clue.title}</a><span class="fine mono"> / ${clue.slug}</span></td>
                <td class="fine">${clue.location || '—'}</td>
                <td class="fine mono">
                  ${clue.requires_clue_no ? `after ${String(clue.requires_clue_no).padStart(3, '0')}` : 'root'}
                </td>
                <td><span class="status-chip" data-state="${clue.is_enabled ? 'open' : 'closed'}">${clue.is_enabled ? 'ENABLED' : 'DISABLED'}</span></td>
                <td class="mono">${dateTimeLabel(clue.updated_at)}</td>
              </tr>`
            )}
          </tbody>
        </table>`}`;

  return adminResult(admin, 'clues', 'CLUES', body);
}

export function adminClueEditorPage({ admin, clue = null, errors = {}, values = {}, message = '' }) {
  const isNew = !clue;
  const action = isNew ? '/admin/clues' : `/admin/clues/${clue.id}`;

  const body = html`
    <h1 class="archive-title">${isNew ? 'NEW CLUE' : `EDIT CLUE ${String(clue.clue_no).padStart(3, '0')}`}</h1>
    ${notice('admin', message)}
    ${errorList(errors)}

    <form method="post" action="${action}" class="admin-form">
      ${html`<input type="hidden" name="csrf" value="${admin.csrf}">`}
      <div class="field-row">
        ${textField({ name: 'clueNo', label: 'CLUE NUMBER', type: 'number', value: values.clueNo ?? '' })}
        ${textField({ name: 'slug', label: 'SLUG', value: values.slug ?? '', required: false, hint: 'Blank means clue-<number>.' })}
      </div>
      ${textField({ name: 'title', label: 'TITLE', value: values.title ?? '' })}
      ${textArea({ name: 'body', label: 'CLUE TEXT', value: values.body ?? '', rows: 8, hint: 'Revealed only after the server accepts the click.' })}
      ${textArea({ name: 'hint', label: 'HINT', value: values.hint ?? '', rows: 2, hint: 'Shown when a locked clue is clicked, or on the clue card.' })}
      ${textField({ name: 'location', label: 'LOCATION', value: values.location ?? '', required: false, hint: 'Where the symbol/redaction lives, e.g. homepage hero.' })}
      <div class="field-row">
        ${textField({ name: 'chapterNo', label: 'CHAPTER', type: 'number', value: values.chapterNo ?? '', required: false })}
        ${textField({ name: 'fileNumber', label: 'FILE NUMBER', type: 'number', value: values.fileNumber ?? '', required: false })}
        ${textField({ name: 'requiresClueNo', label: 'REQUIRES CLUE', type: 'number', value: values.requiresClueNo ?? '', required: false })}
      </div>
      ${checkbox({ name: 'isEnabled', label: 'Enabled (a disabled clue cannot be discovered)', checked: values.isEnabled !== false })}

      <button class="btn primary" type="submit">${isNew ? 'CREATE CLUE' : 'SAVE CLUE'}</button>
    </form>

    <p class="archive-cta"><a class="btn ghost" href="/admin/clues">ALL CLUES</a></p>`;

  return adminResult(admin, 'clues', isNew ? 'NEW CLUE' : `EDIT ${clue.title}`, body);
}

export function adminSubmissionsPage({ admin, submissions = [], counts = {}, status = '', message = '' }) {
  const filters = [
    ['', 'ALL'],
    ['pending_review', 'PENDING'],
    ['correct', 'CORRECT'],
    ['approved', 'APPROVED'],
    ['rewarded', 'REWARDED'],
    ['rejected', 'REJECTED'],
  ];

  const body = html`
    <h1 class="archive-title">SUBMISSIONS</h1>
    ${notice('admin', message)}

    <div class="stats archive-stats">
      ${stat('AWAITING REVIEW', counts.awaiting ?? 0, 'Pending or correct')}
      ${stat('APPROVED', counts.approved ?? 0, 'Reward records created')}
      ${stat('REWARDED', counts.rewarded ?? 0, 'Confirmed on-chain')}
      ${stat('TOTAL', counts.total ?? 0, 'All attempts')}
    </div>

    <nav class="admin-nav filter-nav" aria-label="Submission filter">
      ${filters.map(
        ([value, label]) => html`<a href="/admin/submissions${value ? `?status=${value}` : ''}"
          ${status === value ? raw('aria-current="page"') : raw('')}>${label}</a>`
      )}
    </nav>

    ${submissions.length === 0
      ? html`<p class="fine">No submissions match this filter.</p>`
      : html`<table class="admin-table">
          <thead><tr><th>Submitted</th><th>File</th><th>User</th><th>Attempt</th><th>Holding</th><th>Status</th></tr></thead>
          <tbody>
            ${submissions.map(
              (row) => html`<tr>
                <td class="mono">${dateTimeLabel(row.submitted_at)}</td>
                <td><a href="/admin/submissions/${row.id}">${String(row.file_number).padStart(3, '0')} · ${row.title}</a></td>
                <td>${row.username}</td>
                <td class="mono">${row.attempt_no}</td>
                <td class="mono">${row.holding_snapshot} F106</td>
                <td><span class="status-chip" data-state="${row.status}">${STATUS_LABEL[row.status] || row.status}</span></td>
              </tr>`
            )}
          </tbody>
        </table>`}`;

  return adminResult(admin, 'submissions', 'SUBMISSIONS', body);
}

export function adminSubmissionPage({ admin, submission, answer = '', answerError = '', outcome = null, message = '' }) {
  const pending = ['pending_review', 'correct'].includes(submission.status);

  const body = html`
    <h1 class="archive-title">SUBMISSION / ${String(submission.file_number).padStart(3, '0')}</h1>
    ${notice('admin', message)}

    <div class="stats archive-stats">
      ${stat('STATUS', STATUS_LABEL[submission.status] || submission.status, `Attempt ${submission.attempt_no}`)}
      ${stat('HOLDING AT SUBMISSION', `${submission.holding_snapshot} F106`, `Required ${submission.holding_required} F106`)}
      ${stat('REWARD ON APPROVAL', `${submission.reward} F106`, 'Paid manually, never automatically')}
      ${stat('WALLET', submission.wallet_address.slice(0, 8), submission.wallet_address)}
    </div>

    <div class="admin-panel">
      <p class="eyebrow">PARTICIPANT</p>
      <p class="fine">
        <strong>${submission.username}</strong> · ${submission.email}<br>
        <a href="/archive/${submission.slug}">FILE ${String(submission.file_number).padStart(3, '0')} — ${submission.title}</a>
        · file status <span class="mono">${submission.file_status}</span>
      </p>
    </div>

    <div class="admin-panel">
      <p class="eyebrow">PUZZLE</p>
      <p class="puzzle-text">${submission.prompt}</p>
      <p class="field-label">SUBMITTED ANSWER</p>
      ${answerError
        ? html`<p class="fine">${answerError}</p>`
        : html`<pre class="answer-reveal">${answer}</pre>`}
      <p class="fine">
        The answer was encrypted before storage. It is decrypted here for review only and is not
        written to the audit log.
      </p>
    </div>

    ${outcome
      ? html`<div class="admin-panel">
          <p class="eyebrow">OUTCOME</p>
          <p class="fine">
            Winner <span class="mono">${outcome.winner_id}</span> ·
            ${outcome.reward_id
              ? html`Reward <a href="/admin/rewards/${outcome.reward_id}">#${outcome.reward_no}</a>
                  · ${outcome.amount} F106 · ${PAYMENT_LABEL[outcome.payment_status] || outcome.payment_status}`
              : html`No reward record yet.`}
          </p>
          ${outcome.signature
            ? html`<p class="fine mono break">TX ${outcome.signature}</p>
                <p><a class="btn ghost" href="${outcome.explorer_url}" target="_blank" rel="noopener noreferrer">VIEW TRANSACTION</a></p>`
            : raw('')}
        </div>`
      : raw('')}

    ${pending
      ? html`
          <form method="post" action="/admin/submissions/${submission.id}/approve" class="admin-form compact-form">
            <input type="hidden" name="csrf" value="${admin.csrf}">
            <p class="eyebrow">APPROVE</p>
            <p class="fine">
              Approval reads the wallet's holding from the chain again, creates a winner and a
              reward record, and locks the file. Nothing is paid by this button.
            </p>
            ${textArea({ name: 'note', label: 'REVIEW NOTE (OPTIONAL)', value: '', rows: 2 })}
            <button class="btn primary" type="submit">APPROVE AND CREATE REWARD</button>
          </form>

          <form method="post" action="/admin/submissions/${submission.id}/reject" class="admin-form compact-form">
            <input type="hidden" name="csrf" value="${admin.csrf}">
            <p class="eyebrow">REJECT</p>
            ${textArea({ name: 'note', label: 'REASON (OPTIONAL)', value: '', rows: 2 })}
            <button class="btn ghost" type="submit">REJECT SUBMISSION</button>
          </form>`
      : raw('')}

    <p class="archive-cta">
      <a class="btn ghost" href="/admin/submissions">ALL SUBMISSIONS</a>
      ${outcome?.reward_id ? html`<a class="btn ghost" href="/admin/rewards/${outcome.reward_id}">OPEN REWARD</a>` : raw('')}
    </p>`;

  return adminResult(admin, 'submissions', 'SUBMISSION', body);
}

export function adminRewardsPage({ admin, rewards = [], counts = {}, message = '' }) {
  const body = html`
    <h1 class="archive-title">REWARDS</h1>
    ${notice('admin', message)}

    <div class="stats archive-stats">
      ${stat('AWAITING PAYMENT', counts.awaiting ?? 0, 'Nothing sent yet')}
      ${stat('SENT / VERIFYING', counts.sent ?? 0, 'Signature recorded')}
      ${stat('CONFIRMED', counts.confirmed ?? 0, 'Verified on-chain')}
      ${stat('CONFIRMED TOTAL', `${counts.confirmed_total ?? '0.00000000'} F106`, 'All time')}
    </div>

    <p class="fine">
      The archive holds no treasury key. Send the reward from your own wallet, then paste the
      transaction signature on the reward page. The server reads the chain and only a verified
      transfer marks the reward paid.
    </p>

    ${rewards.length === 0
      ? html`<p class="fine">No reward records yet. Approve a submission to create one.</p>`
      : html`<table class="admin-table">
          <thead><tr><th>Reward</th><th>File</th><th>User</th><th>Amount</th><th>Status</th><th>Transaction</th></tr></thead>
          <tbody>
            ${rewards.map(
              (row) => html`<tr>
                <td class="mono"><a href="/admin/rewards/${row.id}">#${row.reward_no}</a></td>
                <td>${String(row.file_number).padStart(3, '0')} · ${row.title}</td>
                <td>${row.username}</td>
                <td class="mono">${row.amount} F106</td>
                <td><span class="status-chip" data-state="${row.payment_status}">${PAYMENT_LABEL[row.payment_status] || row.payment_status}</span></td>
                <td class="mono">
                  ${row.signature
                    ? html`<a href="${row.explorer_url}" target="_blank" rel="noopener noreferrer">${String(row.signature).slice(0, 10)}…</a>`
                    : '—'}
                </td>
              </tr>`
            )}
          </tbody>
        </table>`}`;

  return adminResult(admin, 'rewards', 'REWARDS', body);
}

export function adminRewardPage({ admin, reward, transactions = [], cluster = 'mainnet-beta', message = '' }) {
  const confirmed = reward.payment_status === 'confirmed';

  const body = html`
    <h1 class="archive-title">REWARD #${reward.reward_no}</h1>
    ${notice('admin', message)}

    <div class="stats archive-stats">
      ${stat('AMOUNT', `${reward.amount} F106`, 'Exactly what was promised')}
      ${stat('FILE', `${String(reward.file_number).padStart(3, '0')}`, reward.title)}
      ${stat('STATUS', PAYMENT_LABEL[reward.payment_status] || reward.payment_status, confirmed ? 'Confirmed on-chain' : 'Manual payout required')}
      ${stat('PARTICIPANT', reward.username, reward.email)}
    </div>

    <div class="admin-panel">
      <p class="eyebrow">DESTINATION</p>
      <p class="wallet-address mono break">${reward.wallet_address}</p>
      <p class="fine">
        Send exactly <strong>${reward.amount} F106</strong> from your own wallet to this address,
        then paste the transaction signature below. Use the official mint only. The verifier checks
        the mint, the recipient, the confirmed commitment and the amount.
      </p>
      <p class="fine mono">
        Explorer cluster: ${cluster}
      </p>
    </div>

    ${confirmed
      ? html`<div class="archive-pending">
          <p class="eyebrow">PAID</p>
          <h2>CONFIRMED ON-CHAIN</h2>
          <p class="fine">This reward is closed. A confirmed reward cannot be confirmed a second time.</p>
        </div>`
      : html`<form method="post" action="/admin/rewards/${reward.id}/transaction" class="admin-form">
          <input type="hidden" name="csrf" value="${admin.csrf}">
          <p class="eyebrow">PAYMENT EVIDENCE</p>
          ${textField({ name: 'signature', label: 'TRANSACTION SIGNATURE', value: '', hint: 'Base58 signature, 64-88 characters.' })}
          ${textArea({ name: 'note', label: 'NOTE (OPTIONAL)', value: '', rows: 2 })}
          <button class="btn primary" type="submit">VERIFY AND MARK PAID</button>
        </form>`}

    <div class="admin-panel">
      <p class="eyebrow">TRANSACTION ATTEMPTS</p>
      ${transactions.length === 0
        ? html`<p class="fine">No signature has been submitted for this reward.</p>`
        : html`<table class="admin-table">
            <thead><tr><th>When</th><th>Signature</th><th>Result</th><th>Amount</th><th>Reason</th></tr></thead>
            <tbody>
              ${transactions.map(
                (tx) => html`<tr>
                  <td class="mono">${dateTimeLabel(tx.submitted_at)}</td>
                  <td class="mono"><a href="${tx.explorer_url}" target="_blank" rel="noopener noreferrer">${String(tx.signature).slice(0, 12)}…</a></td>
                  <td><span class="status-chip" data-state="${tx.verification_status}">${VERIFICATION_LABEL[tx.verification_status] || tx.verification_status}</span></td>
                  <td class="mono">${tx.amount_base_units ?? '—'}</td>
                  <td class="fine">${tx.failure_reason || '—'}</td>
                </tr>`
              )}
            </tbody>
          </table>`}
      <p class="fine">
        Failed and pending attempts are append-only evidence. They do not change the reward.
      </p>
    </div>

    <p class="archive-cta">
      <a class="btn ghost" href="/admin/rewards">ALL REWARDS</a>
      ${reward.submission_id ? html`<a class="btn ghost" href="/admin/submissions/${reward.submission_id}">OPEN SUBMISSION</a>` : raw('')}
    </p>`;

  return adminResult(admin, 'rewards', `REWARD #${reward.reward_no}`, body);
}

export function adminProgressPage({ admin, users = [], message = '' }) {
  const body = html`
    <h1 class="archive-title">PARTICIPANT PROGRESS</h1>
    ${notice('admin', message)}
    <p class="fine">
      Progress is derived from discovery and unlock rows, not from a browser counter. Removing a
      log line cannot fake it.
    </p>

    ${users.length === 0
      ? html`<p class="fine">No participants yet.</p>`
      : html`<table class="admin-table">
          <thead>
            <tr><th>Participant</th><th>Status</th><th>Clues</th><th>Files</th><th>Subs</th><th>Wins</th><th>Confirmed</th><th>Last activity</th></tr>
          </thead>
          <tbody>
            ${users.map(
              (user) => html`<tr>
                <td>${user.username}<span class="fine mono"> / ${user.email}</span></td>
                <td class="mono">${String(user.status).toUpperCase()}</td>
                <td class="mono">${user.clues}</td>
                <td class="mono">${user.unlocks}</td>
                <td class="mono">${user.submissions}</td>
                <td class="mono">${user.wins}</td>
                <td class="mono">${user.confirmed} F106</td>
                <td class="mono">${dateTimeLabel(user.last_activity)}</td>
              </tr>`
            )}
          </tbody>
        </table>`}`;

  return adminResult(admin, 'progress', 'PARTICIPANT PROGRESS', body);
}
