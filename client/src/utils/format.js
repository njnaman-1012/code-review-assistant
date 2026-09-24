export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso ?? '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function truncate(text, length) {
  if (!text) return '';
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export function countLines(code) {
  return code ? code.split('\n').length : 0;
}

// Splits AI text into paragraphs for nicer display.
export function paragraphs(text) {
  return (text || '').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
}

export function scoreColor(score) {
  if (score === null || score === undefined) return 'var(--muted)';
  if (score >= 75) return 'var(--success)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--danger)';
}
