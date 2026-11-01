// Server-rendered HTML with automatic escaping. Every dynamic value goes
// through `escape` unless it was explicitly produced by this file's `html`
// template (already escaped) or wrapped in `raw`. That makes an unescaped
// interpolation impossible to write by accident.

const ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

export const raw = (value) => new SafeHtml(String(value));

function interpolate(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) {
    return value.map((item) => (item instanceof SafeHtml ? item.value : escape(item))).join('');
  }
  if (value === null || value === undefined || value === false) return '';
  return escape(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let index = 0; index < values.length; index += 1) {
    out += interpolate(values[index]);
    out += strings[index + 1];
  }
  return new SafeHtml(out);
}

export const render = (fragment) => (fragment instanceof SafeHtml ? fragment.value : escape(fragment));
