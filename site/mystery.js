// The interactive layer of the FILE106 investigation terminal.
//
// Two kinds of hidden signal live in the rendered pages:
//
//   * the 8_* glyph, marked with data-clue="<n>" and data-clue-kind omitted
//   * a blacked-out passage, marked with data-clue="<n>" and data-clue-kind="redaction"
//
// Both are buttons. The browser asks the server, which owns the clue chain and
// the discovery log; the server answers with the clue text or with the reason it
// is still locked. The page never decides what is clickable.

const CSRF_SELECTOR = 'meta[name="csrf-token"]';

function csrfToken() {
  const meta = document.querySelector(CSRF_SELECTOR);
  return meta ? meta.getAttribute('content') || '' : '';
}

function sourceFor(button) {
  return button.getAttribute('data-clue-kind') === 'redaction' ? 'redaction' : 'symbol';
}

function lockedCopy(error, fallback) {
  if (error === 'clue_locked') {
    return 'SIGNAL LOCKED. DECODE THE EARLIER FRAGMENT FIRST.';
  }
  if (error === 'clue_disabled') {
    return 'THIS SIGNAL HAS GONE DARK.';
  }
  if (error === 'clue_unknown') {
    return 'NO SUCH SIGNAL EXISTS IN THIS ARCHIVE.';
  }
  return fallback || 'THE SIGNAL COULD NOT BE DECODED.';
}

async function decode(button) {
  const clueNo = Number(button.getAttribute('data-clue') || '');
  const source = sourceFor(button);
  const token = csrfToken();

  let response;
  let ok = true;
  try {
    const res = await fetch('/api/mystery/clue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-csrf-token': token } : {}),
      },
      body: JSON.stringify({ clueNo, source }),
    });
    response = await res.json();
    ok = res.ok;
  } catch (error) {
    return { ok: false, error: 'unreachable', message: 'THE TERMINAL LOST SIGNAL. TRY AGAIN.' };
  }

  if (!ok) {
    const errorCode = response.error || 'clue_unknown';
    return { ok: false, error: errorCode, message: lockedCopy(errorCode) };
  }

  const clue = response;
  if (!clue || clue.clueNo === undefined) {
    return { ok: false, error: 'clue_unknown', message: 'THE SIGNAL COULD NOT BE DECODED.' };
  }

  // Replace the trigger with the revealed evidence. Text nodes are assigned
  // directly, so nothing the visitor typed is ever echoed back into the page.
  const reveal = document.createElement('div');
  reveal.className = 'clue-reveal';

  const head = document.createElement('p');
  head.className = 'eyebrow';
  head.textContent = `SIGNAL ${String(clue.clueNo).padStart(3, '0')} / DECODED`;

  const title = document.createElement('h3');
  title.textContent = clue.title || `SIGNAL ${String(clue.clueNo).padStart(3, '0')}`;

  const body = document.createElement('div');
  body.className = 'document-body';
  body.textContent = clue.body || '';

  const meta = document.createElement('p');
  meta.className = 'fine mono';
  meta.textContent = [clue.location, clue.logged ? 'LOGGED TO THIS TERMINAL' : 'PUBLIC SIGNAL']
    .filter(Boolean)
    .join(' / ');

  const note = document.createElement('p');
  note.className = 'fine';
  note.textContent = clue.hint || 'Keep the recovered fragment. It will open the next door.';

  reveal.append(head, title, body, meta, note);
  // Only the trigger itself is replaced, so a document holding several markers
  // keeps the others clickable.
  button.replaceWith(reveal);

  return { ok: true, clue };
}

function wireButtons() {
  const buttons = Array.from(document.querySelectorAll('[data-clue]'));
  for (const button of buttons) {
    button.addEventListener('click', async () => {
      if (button.dataset.pending === 'true') return;
      button.dataset.pending = 'true';
      const result = await decode(button);
      button.dataset.pending = 'false';
      if (!result.ok) {
        const hint = document.createElement('p');
        hint.className = 'archive-notice';
        hint.setAttribute('data-kind', 'clue');
        hint.textContent = result.message;
        if (button.parentElement) button.parentElement.append(hint);
        if (button.isConnected) button.classList.add('is-locked');
      }
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireButtons);
} else {
  wireButtons();
}
