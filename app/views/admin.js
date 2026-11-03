import { html, raw } from '../lib/html.js';
import { csrfField, csrfToken } from '../lib/csrf.js';
import { dateLabel, dateTimeLabel, dateTimeInput } from '../lib/format.js';
import { DIFFICULTIES, FILE_STATUSES, WINNER_METHODS } from '../lib/validate.js';
import { page, notice, errorList } from './layout.js';
import { STATUS_COPY } from './archive.js';

const roleLabel = (role) => String(role || '').toUpperCase();

// The archivist terminal has its own navigation inside the page; the shared top
// bar only points back at the public archive.
const ADMIN_NAV = html`<a href="/archive">VIEW ARCHIVE</a>`;

export function adminShell({ admin, active, body }) {
  return html`<section class="section archive-section">
    <div class="admin-bar">
      <div>
        <p class="eyebrow">ARCHIVIST TERMINAL</p>
        <p class="admin-id">
          <strong>${admin.display_name}</strong> · ${roleLabel(admin.role)} · ${admin.email}
        </p>
      </div>
      <nav class="admin-nav" aria-label="Archivist">
        <a href="/admin" ${active === 'overview' ? raw('aria-current="page"') : raw('')}>OVERVIEW</a>
        <a href="/admin/files" ${active === 'files' ? raw('aria-current="page"') : raw('')}>FILES</a>
        <a href="/admin/files/new">NEW FILE</a>
        <a href="/admin/chapters" ${active === 'chapters' ? raw('aria-current="page"') : raw('')}>CHAPTERS</a>
        <a href="/admin/clues" ${active === 'clues' ? raw('aria-current="page"') : raw('')}>CLUES</a>
        <a href="/admin/submissions" ${active === 'submissions' ? raw('aria-current="page"') : raw('')}>SUBMISSIONS</a>
        <a href="/admin/rewards" ${active === 'rewards' ? raw('aria-current="page"') : raw('')}>REWARDS</a>
        <a href="/admin/progress" ${active === 'progress' ? raw('aria-current="page"') : raw('')}>PROGRESS</a>
        <form method="post" action="/admin/logout" class="nav-form">
          ${csrfField({ csrf: admin.csrf })}
          <button type="submit" class="nav-button">SIGN OUT</button>
        </form>
      </nav>
    </div>
    ${body}
  </section>`;
}

const sizeLabel = (bytes) => `${(Number(bytes) / 1024).toFixed(1)} KB`;

export function textField({ name, label, value = '', type = 'text', hint = '', required = true, step = '' }) {
  return html`<label class="field">
    <span class="field-label">${label}</span>
    <input
      class="field-input"
      type="${type}"
      name="${name}"
      value="${value}"
      ${step ? raw(`step="${step}"`) : raw('')}
      ${required ? raw('required') : raw('')}
    >
    ${hint ? html`<span class="field-hint">${hint}</span>` : raw('')}
  </label>`;
}

export function textArea({ name, label, value = '', rows = 6, hint = '' }) {
  return html`<label class="field">
    <span class="field-label">${label}</span>
    <textarea class="field-input" name="${name}" rows="${rows}">${value}</textarea>
    ${hint ? html`<span class="field-hint">${hint}</span>` : raw('')}
  </label>`;
}

export function selectField({ name, label, options, value, hint = '' }) {
  return html`<label class="field">
    <span class="field-label">${label}</span>
    <select class="field-input" name="${name}">
      ${options.map(
        (option) => html`<option value="${option}" ${option === value ? raw('selected') : raw('')}>${option}</option>`
      )}
    </select>
    ${hint ? html`<span class="field-hint">${hint}</span>` : raw('')}
  </label>`;
}

export function adminLoginPage({ session, errors = {}, values = {}, message = '' }) {
  const body = html`
    <section class="section archive-section">
      <p class="eyebrow">TERMINAL / ARCHIVIST ACCESS</p>
      <h1 class="archive-title">STAFF SIGN IN</h1>
      <p class="lede">
        This terminal edits what the public sees. Participant accounts cannot reach it, and an
        archivist session expires far sooner than a participant session.
      </p>

      ${notice('form', message)}
      ${errorList(errors)}

      <form method="post" action="/admin/login" class="auth-form" autocomplete="on">
        ${csrfField(session)}
        ${textField({ name: 'email', label: 'EMAIL', type: 'email', value: values.email || '' })}
        ${textField({ name: 'password', label: 'PASSWORD', type: 'password' })}
        <button class="btn primary" type="submit">UNLOCK ARCHIVE</button>
      </form>
    </section>`;

  return page({ title: 'FILE106 — ARCHIVIST', body, session, terminalLabel: 'ARCHIVIST' });
}

export function stat(label, value, note) {
  return html`<div class="stat">
    <span class="stat-label">${label}</span>
    <strong>${value}</strong>
    ${note ? html`<span class="stat-note">${note}</span>` : raw('')}
  </div>`;
}

export function adminOverviewPage({ admin, stats, recent = [], message = '' }) {
  const body = html`
    <h1 class="archive-title">OVERVIEW</h1>
    ${notice('admin', message)}

    <div class="stats archive-stats">
      ${stat('FILES', stats.files ?? 0, `${stats.open ?? 0} open · ${stats.mystery_files ?? 0} mystery`)}
      ${stat('IN DRAFT', stats.draft ?? 0, 'Invisible to the public')}
      ${stat('SUBMISSIONS', stats.submissions ?? 0, `${stats.pending ?? 0} awaiting review`)}
      ${stat('PAYMENTS', stats.awaiting_payment ?? 0, 'Awaiting manual payment')}
      ${stat('CHAPTERS', stats.chapters ?? 0, 'Published')}
      ${stat('CLUES', stats.clues ?? 0, 'Enabled signals')}
    </div>

    <div class="admin-panel">
      <p class="eyebrow">RECENT ACTIONS</p>
      ${recent.length === 0
        ? html`<p class="fine">Nothing recorded yet.</p>`
        : html`<table class="admin-table">
            <thead><tr><th>When</th><th>Action</th><th>Entity</th></tr></thead>
            <tbody>
              ${recent.map(
                (row) => html`<tr>
                  <td class="mono">${dateTimeLabel(row.created_at)}</td>
                  <td>${row.action}</td>
                  <td class="mono">${row.entity}${row.entity_id ? ` · ${String(row.entity_id).slice(0, 8)}` : ''}</td>
                </tr>`
              )}
            </tbody>
          </table>`}
    </div>`;

  return page({
    title: 'FILE106 — ARCHIVIST OVERVIEW',
    body: adminShell({ admin, active: 'overview', body }),
    session: { csrf: admin.csrf },
    nav: ADMIN_NAV,
    terminalLabel: 'ARCHIVIST',
  });
}

export function adminFilesPage({ admin, files = [], message = '' }) {
  const body = html`
    <h1 class="archive-title">FILE MANAGER</h1>
    ${notice('admin', message)}
    <p class="fine">
      Drafts are invisible to the public. Publishing is a status change, not a copy: the same
      record is what participants then see.
    </p>

    ${files.length === 0
      ? html`<div class="archive-pending">
          <p class="eyebrow">NOTHING HERE YET</p>
          <h2>NO FILES</h2>
          <p class="fine"><a href="/admin/files/new">Create the first file</a>.</p>
        </div>`
      : html`<table class="admin-table">
          <thead>
            <tr><th>№</th><th>File</th><th>Status</th><th>Reward</th><th>Subs</th><th>Updated</th></tr>
          </thead>
          <tbody>
            ${files.map(
              (file) => html`<tr>
                <td class="mono">${String(file.file_number).padStart(3, '0')}</td>
                <td>
                  <a href="/admin/files/${file.id}">${file.title}</a>
                  <span class="fine mono">/archive/${file.slug}</span>
                </td>
                <td><span class="status-chip" data-state="${file.status}">${STATUS_COPY[file.status]?.label || file.status}</span></td>
                <td class="mono">${file.reward}</td>
                <td class="mono">${file.submissions_total ?? 0}</td>
                <td class="mono">${dateLabel(file.updated_at)}</td>
              </tr>`
            )}
          </tbody>
        </table>`}`;

  return page({
    title: 'FILE106 — FILE MANAGER',
    body: adminShell({ admin, active: 'files', body }),
    session: { csrf: admin.csrf },
    nav: ADMIN_NAV,
    terminalLabel: 'ARCHIVIST',
  });
}

function attachmentPanel({ file, attachments, csrf, fileId }) {
  return html`<div class="admin-panel" id="attachment-panel" data-csrf="${csrf}" data-file-id="${fileId}">
    <p class="eyebrow">ATTACHMENTS</p>
    <p class="fine">
      Stored outside the public site and served only through this terminal. There is no public
      URL for any attachment, so a leaked page cannot leak an exhibit.
    </p>

    ${attachments.length === 0
      ? html`<p class="fine">No attachments.</p>`
      : html`<table class="admin-table">
          <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Checksum</th><th></th></tr></thead>
          <tbody>
            ${attachments.map(
              (item) => html`<tr>
                <td><a href="/admin/attachments/${item.id}">${item.filename}</a></td>
                <td class="mono">${item.mime_type}</td>
                <td class="mono">${sizeLabel(item.byte_size)}</td>
                <td class="mono">${String(item.checksum_sha256 || '').slice(0, 12)}</td>
                <td>
                  <form method="post" action="/admin/files/${fileId}/attachments/${item.id}/delete" class="inline-form">
                    ${csrfField({ csrf })}
                    <button type="submit" class="nav-button">REMOVE</button>
                  </form>
                </td>
              </tr>`
            )}
          </tbody>
        </table>`}

    <div class="upload-row">
      <label class="field">
        <span class="field-label">ADD FILE</span>
        <input class="field-input" type="file" data-upload-input
               accept="image/png,image/jpeg,image/webp,application/pdf,text/plain">
      </label>
      <button class="btn ghost" type="button" data-upload-action="attach">UPLOAD</button>
    </div>
    <p class="wallet-status" data-upload-status role="status"></p>
  </div>`;
}

export function adminFileEditorPage({
  admin,
  file = null,
  challenge = null,
  attachments = [],
  errors = {},
  values = {},
  message = '',
}) {
  const isNew = !file;
  const action = isNew ? '/admin/files' : `/admin/files/${file.id}`;
  const csrf = admin.csrf;

  const body = html`
    <h1 class="archive-title">${isNew ? 'NEW FILE' : `EDIT FILE ${String(file.file_number).padStart(3, '0')}`}</h1>
    ${notice('admin', message)}
    ${errorList(errors)}

    <form method="post" action="${action}" class="admin-form">
      ${csrfField({ csrf })}
      <div class="field-row">
        ${textField({ name: 'fileNumber', label: 'FILE NUMBER', type: 'number', value: values.fileNumber ?? '', hint: 'Unique. Drives the default slug.' })}
        ${textField({ name: 'slug', label: 'SLUG', value: values.slug ?? '', required: false, hint: 'Blank means file-<number>.' })}
      </div>

      ${textField({ name: 'title', label: 'TITLE', value: values.title ?? '' })}
      ${textArea({ name: 'teaser', label: 'PUBLIC TEASER', value: values.teaser ?? '', rows: 2, hint: 'Shown in the list. Never put the answer here.' })}
      ${textArea({ name: 'briefing', label: 'BRIEFING', value: values.briefing ?? '', rows: 10, hint: 'Shown on the file page, escaped as text. Line breaks are preserved.' })}

      <div class="field-row">
        ${selectField({ name: 'difficulty', label: 'DIFFICULTY', options: DIFFICULTIES, value: values.difficulty ?? 'medium' })}
        ${selectField({ name: 'winnerMethod', label: 'WINNER METHOD', options: WINNER_METHODS, value: values.winnerMethod ?? 'first_correct' })}
      </div>

      <div class="field-row">
        ${textField({ name: 'reward', label: 'REWARD (F106)', value: values.reward ?? '', step: '0.00000001', hint: 'Paid manually after on-chain verification.' })}
        ${textField({ name: 'minHolding', label: 'MIN HOLDING (F106)', value: values.minHolding ?? '', step: '0.00000001', hint: 'Checked against the chain at submission time.' })}
        ${textField({ name: 'maxWinners', label: 'MAX WINNERS', type: 'number', value: values.maxWinners ?? '', required: false, hint: 'Blank for no cap.' })}
      </div>

      <div class="field-row">
        ${textField({ name: 'opensAt', label: 'OPENS (UTC)', type: 'datetime-local', value: values.opensAt ?? '', required: false })}
        ${textField({ name: 'closesAt', label: 'CLOSES (UTC)', type: 'datetime-local', value: values.closesAt ?? '', required: false })}
      </div>

      <div class="admin-panel">
        <p class="eyebrow">MYSTERY LAYER</p>
        <p class="fine">These fields are only used when the file is part of the Project105 investigation.</p>
        <label class="field field-check">
          <input type="checkbox" name="isMystery" value="1" ${values.isMystery ? raw('checked') : raw('')}>
          <span>Treat as a mystery file (enables lock rules and document rendering)</span>
        </label>
        <div class="field-row">
          ${textField({ name: 'classification', label: 'CLASSIFICATION', value: values.classification ?? 'UNCLASSIFIED', required: false })}
          ${textField({ name: 'chapterNo', label: 'CHAPTER', type: 'number', value: values.chapterNo ?? '', required: false })}
          ${textField({ name: 'mysteryOrder', label: 'ORDER', type: 'number', value: values.mysteryOrder ?? '', required: false })}
        </div>
        ${textArea({ name: 'loreBody', label: 'RECOVERED DOCUMENT', value: values.loreBody ?? '', rows: 12, hint: 'Use [[SYMBOL:1]] and [[REDACT:2]] to attach clues. Clue text is only revealed server-side.' })}
        ${textArea({ name: 'unlockHint', label: 'UNLOCK HINT', value: values.unlockHint ?? '', rows: 2, hint: 'Shown to the visitor on a code-locked file. Never include the code.' })}
        <div class="field-row">
          ${textField({ name: 'requiredFileNumber', label: 'REQUIRED FILE NUMBER', type: 'number', value: values.requiredFileNumber ?? '', required: false })}
          ${textField({ name: 'unlockRequiresClue', label: 'REQUIRES CLUE NUMBER', type: 'number', value: values.unlockRequiresClue ?? '', required: false })}
        </div>
        <div class="field-row">
          ${textField({ name: 'unlockCode', label: values.hasUnlockCode ? 'NEW ACCESS CODE (leave blank to keep)' : 'ACCESS CODE', type: 'password', value: '', required: false, hint: 'Stored as a scrypt hash, never shown again.' })}
        </div>
        ${values.hasUnlockCode
          ? html`<label class="field field-check">
              <input type="checkbox" name="removeUnlockCode" value="1">
              <span>Remove the existing access code</span>
            </label>`
          : raw('')}
      </div>

      <button class="btn primary" type="submit">${isNew ? 'CREATE DRAFT' : 'SAVE CHANGES'}</button>
    </form>

    ${isNew
      ? raw('')
      : html`<form method="post" action="/admin/files/${file.id}/status" class="admin-form compact-form">
          ${csrfField({ csrf })}
          <div class="field-row">
            ${selectField({ name: 'status', label: 'PUBLIC STATUS', options: FILE_STATUSES, value: file.status, hint: STATUS_COPY[file.status]?.note || '' })}
            <button class="btn ghost" type="submit">APPLY STATUS</button>
          </div>
        </form>`}

    ${isNew
      ? html`<p class="fine">Create the draft first; the answer and attachments appear on the next screen.</p>`
      : html`<div class="admin-panel">
          <p class="eyebrow">CHALLENGE / ANSWER</p>
          <p class="fine">
            The answer is hashed with scrypt and only the hash is stored. It cannot be read back
            here, and it cannot be changed once someone has submitted against it.
          </p>

          ${challenge
            ? html`<p class="fine">
                Sealed: ${challenge.answer_format} · ${challenge.case_sensitive ? 'case sensitive' : 'case insensitive'} ·
                ${challenge.max_attempts} attempt(s) · updated ${dateLabel(challenge.updated_at)}
              </p>`
            : html`<p class="fine">No answer set yet. The file cannot award anything until one is.</p>`}

          <form method="post" action="/admin/files/${file.id}/challenge" class="admin-form">
            ${csrfField({ csrf })}
            ${textArea({ name: 'prompt', label: 'PROMPT', value: values.prompt ?? '', rows: 4, hint: 'What the participant is asked. Public.' })}
            ${textField({ name: 'answer', label: 'ANSWER', type: 'password', value: '', hint: 'Never stored, never echoed back, never logged.' })}
            <div class="field-row">
              ${selectField({ name: 'answerFormat', label: 'ANSWER FORMAT', options: ['text', 'numeric'], value: values.answerFormat ?? 'text' })}
              ${textField({ name: 'maxAttempts', label: 'MAX ATTEMPTS', type: 'number', value: values.maxAttempts ?? '1' })}
            </div>
            <label class="field field-check">
              <input type="checkbox" name="caseSensitive" value="1">
              <span>Case sensitive (leave off unless the casing is part of the puzzle)</span>
            </label>
            <button class="btn primary" type="submit">${challenge ? 'REPLACE ANSWER' : 'SEAL ANSWER'}</button>
          </form>
        </div>

        ${attachmentPanel({ file, attachments, csrf, fileId: file.id })}`}
  `;

  return page({
    title: isNew ? 'FILE106 — NEW FILE' : `FILE106 — ${file.title}`,
    body: adminShell({ admin, active: 'files', body }),
    session: { csrf },
    scripts: ['/admin.js'],
    nav: ADMIN_NAV,
    terminalLabel: 'ARCHIVIST',
  });
}
