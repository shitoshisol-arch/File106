// Rendering and access rules for the mystery layer.
//
// A recovered document is stored as plain text. Two markers are understood:
//
//   [[SYMBOL:4]]  renders the recurring 8_* glyph, wired to clue 4
//   [[REDACT:5]]  renders a blacked-out passage, wired to clue 5
//
// The clue text itself is never placed in the document markup. The browser has
// to ask the server, which checks that the clue exists, that its predecessor has
// been decoded, and (for an account) records the discovery exactly once.

import { escape, html, raw } from './html.js';

const MARKER = /\[\[(SYMBOL|REDACT):(\d{1,3})\]\]/g;

export function renderDocument(value) {
  const text = String(value ?? '');
  if (!text) return raw('');

  const parts = [];
  let cursor = 0;

  for (const match of text.matchAll(MARKER)) {
    if (match.index > cursor) parts.push(escape(text.slice(cursor, match.index)));

    const kind = match[1];
    const clueNo = Number.parseInt(match[2], 10);
    const label = `CLUE ${String(clueNo).padStart(3, '0')}`;

    if (kind === 'SYMBOL') {
      parts.push(
        html`<button type="button" class="glyph glyph-inline" data-clue="${clueNo}"
          aria-label="Inspect recovered symbol for ${label}">8_*</button>`
      );
    } else {
      parts.push(
        html`<button type="button" class="redacted" data-clue="${clueNo}" data-clue-kind="redaction"
          aria-label="Reveal redacted passage ${label}"><span aria-hidden="true">████████</span><span class="sr-only">REDACTED</span></button>`
      );
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) parts.push(escape(text.slice(cursor)));

  return html`<div class="document-body">${parts}</div>`;
}

export function clueLabel(no) {
  return `CLUE ${String(no).padStart(3, '0')}`;
}

export function fileLabel(no) {
  return `FILE ${String(no).padStart(3, '0')}`;
}

// A file is open when every rule is satisfied. The order matters only for the
// explanation shown to the visitor: a missing prerequisite is more useful than
// "a code is required" when both are true.
export function fileLockState({ file, discoveredClues = new Set(), unlockedNumbers = new Set() }) {
  if (!file) return { locked: true, reason: 'missing', method: null };

  if (unlockedNumbers.has(Number(file.file_number))) {
    // A code-unlocked file is in unlockedNumbers too, so this is the normal
    // "already recovered" path.
    return { locked: false, reason: '', method: 'open' };
  }

  if (file.required_file_number && !unlockedNumbers.has(Number(file.required_file_number))) {
    return {
      locked: true,
      reason: 'prerequisite',
      method: null,
      requiredFile: Number(file.required_file_number),
    };
  }

  if (file.unlock_requires_clue && !discoveredClues.has(Number(file.unlock_requires_clue))) {
    return {
      locked: true,
      reason: 'clue',
      method: null,
      requiredClue: Number(file.unlock_requires_clue),
    };
  }

  if (file.has_unlock_code) {
    return { locked: true, reason: 'code', method: null };
  }

  return { locked: false, reason: '', method: 'open' };
}

// Chapters use their own, simpler rule: a published chapter is readable when
// enough clues have been recovered and its required file has been opened.
export function chapterLockState({ chapter, discoveredCount = 0, unlockedNumbers = new Set() }) {
  if (!chapter) return { locked: true, reason: 'missing' };

  if (Number(chapter.required_clue_count) > discoveredCount) {
    return {
      locked: true,
      reason: 'clues',
      missing: Number(chapter.required_clue_count) - discoveredCount,
    };
  }

  if (chapter.required_file_number && !unlockedNumbers.has(Number(chapter.required_file_number))) {
    return {
      locked: true,
      reason: 'file',
      requiredFile: Number(chapter.required_file_number),
    };
  }

  return { locked: false, reason: '' };
}

export function progressPercent(parts, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((parts / total) * 100)));
}
