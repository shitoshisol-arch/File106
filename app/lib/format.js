// Date rendering for server-side pages. Every timestamp is shown in UTC with
// the unit spelled out, because the archive's deadlines are absolute and a
// participant in another timezone must not have to guess which clock it is.

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateLabel(value) {
  const date = asDate(value);
  if (!date) return '—';
  return `${date.toISOString().slice(0, 10)} UTC`;
}

export function dateTimeLabel(value) {
  const date = asDate(value);
  if (!date) return '—';
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

// For inputs of type datetime-local, which have no timezone: the admin types
// UTC and the browser does not reinterpret it.
export function dateTimeInput(value) {
  const date = asDate(value);
  if (!date) return '';
  return date.toISOString().slice(0, 16);
}

// "closes in 3 days" beats an absolute timestamp for a deadline people scan.
export function relativeLabel(value) {
  const date = asDate(value);
  if (!date) return '';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const magnitude = Math.abs(seconds);

  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];

  for (const [name, size] of units) {
    if (magnitude >= size) {
      const count = Math.round(magnitude / size);
      const plural = count === 1 ? '' : 's';
      return seconds > 0 ? `in ${count} ${name}${plural}` : `${count} ${name}${plural} ago`;
    }
  }
  return seconds > 0 ? 'in under a minute' : 'just now';
}
