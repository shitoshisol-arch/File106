import { html, raw } from '../lib/html.js';
import { dateTimeLabel } from '../lib/format.js';
import { clueLabel, fileLabel, progressPercent, renderDocument } from '../lib/mystery.js';
import { page, notice } from './layout.js';

function progressBar(percent, label) {
  return html`<div class="progress" role="group" aria-label="${label}">
    <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
         aria-valuenow="${percent}" aria-label="${label}">
      <span class="progress-fill" style="width: ${percent}%"></span>
    </div>
    <p class="progress-label mono">${percent}% RECOVERED</p>
  </div>`;
}

function chapterCard(chapter) {
  return html`<article class="chapter-card ${chapter.locked ? 'is-locked' : ''}">
    <p class="file-index mono">${chapter.eyebrow} / ${String(chapter.chapter_no).padStart(2, '0')}</p>
    <h3>
      ${chapter.locked
        ? html`<span>${chapter.title}</span>`
        : html`<a href="/investigate/chapter/${chapter.chapter_no}">${chapter.title}</a>`}
    </h3>
    <p class="file-teaser">${chapter.summary}</p>
    ${chapter.locked
      ? html`<p class="fine">ENCRYPTED — ${chapter.lockMessage}</p>`
      : html`<p class="file-meta"><span class="mono">DECRYPTED</span><span class="mono">${dateTimeLabel(chapter.updated_at)}</span></p>`}
  </article>`;
}

function discoveryCard(row) {
  return html`<article class="clue-card">
    <p class="file-index mono">${clueLabel(row.clue_no)} / RECOVERED</p>
    <h3>${row.title}</h3>
    ${renderDocument(row.body)}
    ${row.hint ? html`<p class="fine">ARCHIVIST NOTE: ${row.hint}</p>` : raw('')}
    <p class="fine mono">${dateTimeLabel(row.discovered_at)}${row.location ? ` / ${row.location}` : ''}</p>
  </article>`;
}

function fileRow(row) {
  return html`<li class="evidence-row ${row.locked ? 'is-locked' : ''}">
    <span class="mono">${fileLabel(row.file_number)}</span>
    <span>
      ${row.locked
        ? html`<span>${row.title}</span>`
        : html`<a href="/archive/${row.slug}">${row.title}</a>`}
      <span class="fine"> / ${row.classification || 'UNCLASSIFIED'}</span>
    </span>
    ${row.locked && row.requiredClue
      ? html`<button type="button" class="glyph glyph-inline" data-clue="${row.requiredClue}" aria-label="Investigate the hidden symbol for ${fileLabel(row.file_number)}">8_*</button>`
      : raw('')}
    <span class="mono status-chip" data-state="${row.locked ? 'locked' : 'open'}">
      ${row.locked ? 'SEALED' : 'RECOVERED'}
    </span>
  </li>`;
}

export function investigatePage({
  session,
  signedIn = false,
  username = '',
  chapters = [],
  files = [],
  investigation,
  message = '',
}) {
  const discovered = investigation.discoveries;
  const body = html`
    <section class="section archive-section investigate-section">
      <p class="eyebrow">TERMINAL / INVESTIGATION</p>
      <h1 class="archive-title">THE PROJECT105 INCIDENT</h1>
      <p class="lede">
        Project105 was terminated. FILE106 appeared afterwards, with no creator, no origin and
        no valid timestamp. The archive is still active. Recover what the deletion missed.
      </p>
      <p class="terminal-line mono">
        <span>visitor@file106:~$ recover --next</span>
        <span class="terminal-cursor" aria-hidden="true">█</span>
      </p>

      ${notice('archive', message)}

      ${progressBar(
        investigation.percent,
        `Investigation progress: ${investigation.percent} percent`
      )}

      <div class="stats archive-stats" aria-label="Investigation progress">
        <div class="stat">
          <span class="stat-label">CLUES RECOVERED</span>
          <strong>${investigation.cluesFound}/${investigation.cluesTotal}</strong>
          <span class="stat-note">Signals decoded in the log</span>
        </div>
        <div class="stat">
          <span class="stat-label">FILES OPENED</span>
          <strong>${investigation.filesUnlocked}/${investigation.filesTotal}</strong>
          <span class="stat-note">Records recovered</span>
        </div>
        <div class="stat">
          <span class="stat-label">PUZZLES SOLVED</span>
          <strong>${investigation.puzzlesSolved}/${investigation.puzzlesTotal}</strong>
          <span class="stat-note">Accepted answers</span>
        </div>
        <div class="stat">
          <span class="stat-label">CLAIMS</span>
          <strong>${investigation.pending}</strong>
          <span class="stat-note">${investigation.wins} approved / ${investigation.confirmedF106} F106 confirmed</span>
        </div>
      </div>

      ${signedIn
        ? raw('')
        : html`<div class="archive-pending">
            <p class="eyebrow">NO LOG ON THIS TERMINAL</p>
            <h2>DISCOVERIES NEED AN ACCOUNT</h2>
            <p class="fine">
              The signals can be inspected without signing in, but only a registered account can
              keep a log, unlock files, submit answers or claim a reward.
            </p>
            <p class="archive-cta">
              <a class="btn primary" href="/register">REGISTER</a>
              <a class="btn ghost" href="/login">SIGN IN</a>
            </p>
          </div>`}

      <div class="archive-group">
        <div class="archive-group-head">
          <h2 class="archive-group-title">CHAPTERS</h2>
          <span class="fine">The incident unfolds in four recovered parts.</span>
        </div>
        <div class="chapter-grid">${chapters.map(chapterCard)}</div>
      </div>

      <div class="archive-group">
        <div class="archive-group-head">
          <h2 class="archive-group-title">EVIDENCE INDEX</h2>
          <span class="fine">Sealed files open when their requirement is met.</span>
        </div>
        ${files.length === 0
          ? html`<p class="fine">No mystery files are published yet.</p>`
          : html`<ul class="evidence-list">${files.map(fileRow)}</ul>`}
      </div>

      <div class="archive-group">
        <div class="archive-group-head">
          <h2 class="archive-group-title">INVESTIGATION LOG</h2>
          <span class="fine">${discovered.length} of ${investigation.cluesTotal} signals decoded.</span>
        </div>
        ${discovered.length === 0
          ? html`<div class="archive-pending">
              <p class="eyebrow">NO SIGNALS DECODED</p>
              <h2>LOOK CLOSER</h2>
              <p class="fine">
                Hidden symbols and blacked-out passages are scattered across the homepage, the
                archive and the recovered documents. A decoded signal reveals where the next one
                is hiding.
              </p>
              <p><a class="btn primary" href="/">RETURN TO THE OPENING SCREEN</a></p>
            </div>`
          : html`<div class="clue-grid">${discovered.map(discoveryCard)}</div>`}
      </div>

      <div class="archive-pending">
        <p class="eyebrow">RECOVERY STATUS</p>
        <h2>${username ? `CUSTODIAN: ${username}` : 'PUBLIC TERMINAL'}</h2>
        <p class="fine">
          ${signedIn
            ? 'Your log is stored against your account. A hidden symbol can only be logged once.'
            : 'Sign in to bind discoveries to an account.'}
        </p>
        <p class="archive-cta">
          <a class="btn ghost" href="/archive">OPEN THE ARCHIVE</a>
          ${signedIn ? html`<a class="btn ghost" href="/dashboard">MY INVESTIGATION</a>` : raw('')}
        </p>
      </div>
    </section>`;

  return page({
    title: 'FILE106 — THE INVESTIGATION',
    body,
    session,
    signedIn,
    signedInName: username,
    scripts: ['/mystery.js'],
  });
}

export function chapterPage({ session, signedIn, username, chapter, locked, next, investigation, message = '' }) {
  const body = html`
    <section class="section archive-section investigate-section">
      <p class="eyebrow">${chapter.eyebrow} / ${String(chapter.chapter_no).padStart(2, '0')}</p>
      <h1 class="archive-title">${chapter.title}</h1>
      <p class="lede">${chapter.summary}</p>

      ${notice('archive', message)}

      ${locked
        ? html`<div class="archive-pending">
            <p class="eyebrow">ENCRYPTED CHAPTER</p>
            <h2>ACCESS DENIED</h2>
            <p class="fine">
              Recover ${Math.max(1, Number(chapter.required_clue_count) - investigation.cluesFound)}
              more clue(s) before this chapter decrypts.
            </p>
            <p><a class="btn primary" href="/investigate">RETURN TO THE LOG</a></p>
          </div>`
        : html`<div class="document">
            <div class="document-head">
              <span class="mono">${chapter.eyebrow}</span>
              <span class="stamp-inline mono">RECOVERED</span>
            </div>
            ${renderDocument(chapter.body)}
          </div>`}

      <div class="archive-group">
        <div class="archive-group-head">
          <h2 class="archive-group-title">LOG</h2>
          <span class="fine">${investigation.cluesFound} clue(s) recovered.</span>
        </div>
        <p class="fine">
          ${signedIn
            ? 'Click any 8_* or redacted passage above to decode it. The log records each signal once.'
            : 'Sign in to decode and keep these signals.'}
        </p>
        <p class="archive-cta">
          <a class="btn ghost" href="/investigate">ALL CHAPTERS</a>
          ${chapter.chapter_no > 1 ? html`<a class="btn ghost" href="/investigate/chapter/${chapter.chapter_no - 1}">PREVIOUS</a>` : raw('')}
          ${next ? html`<a class="btn ghost" href="/investigate/chapter/${next.chapter_no}">NEXT</a>` : raw('')}
        </p>
      </div>
    </section>`;

  return page({
    title: `FILE106 — ${chapter.title}`,
    body,
    session,
    signedIn,
    signedInName: username,
    scripts: ['/mystery.js'],
  });
}
