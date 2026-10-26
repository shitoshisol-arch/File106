const copyButtons = document.querySelectorAll('[data-copy]');

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '-1000px';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();

  if (!copied) {
    throw new Error('Copy command was rejected');
  }
}

copyButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const text = button.getAttribute('data-copy') || '';
    const original = button.textContent || 'Copy';

    try {
      await copyText(text);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Select manually';
    }

    window.setTimeout(() => {
      button.textContent = original;
    }, 1600);
  });
});
