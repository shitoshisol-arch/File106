// Attachment upload for the archivist terminal.
//
// The browser sends the file as a raw body rather than a multipart form: one
// PUT, the bytes as the body, the name and type in the query and the header.
// That keeps the server free of a multipart parser whose only job here would be
// to unwrap what fetch can already send.
//
// Nothing in this file decides where the file is stored. The server picks the
// key, and the response carries only a record id.

function panel() {
  return document.getElementById('attachment-panel');
}

function say(element, message, kind = '') {
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
}

function initAttachmentPanel() {
  const root = panel();
  if (!root) return;

  const csrf = root.dataset.csrf || '';
  const fileId = root.dataset.fileId || '';
  const input = root.querySelector('[data-upload-input]');
  const status = root.querySelector('[data-upload-status]');
  const button = root.querySelector('[data-upload-action="attach"]');

  async function upload() {
    const file = input?.files?.[0];
    if (!file) {
      say(status, 'CHOOSE A FILE FIRST.', 'error');
      return;
    }

    const query = new URLSearchParams({ filename: file.name });

    say(status, 'UPLOADING...');

    let response;
    try {
      response = await fetch(`/api/admin/files/${fileId}/attachments?${query}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-csrf-token': csrf,
        },
        body: file,
      });
    } catch {
      say(status, 'UPLOAD FAILED: THE TERMINAL IS UNREACHABLE.', 'error');
      return;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      say(status, String(payload.message || `UPLOAD REFUSED (${response.status})`).toUpperCase(), 'error');
      return;
    }

    say(status, 'STORED. RELOADING...', 'ok');
    window.location.reload();
  }

  button?.addEventListener('click', upload);

  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) say(status, `${file.name} · ${(file.size / 1024).toFixed(1)} KB READY.`);
  });
}

initAttachmentPanel();
