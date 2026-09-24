// Small text helpers shared by the analyzer, AI prompt and report generator.

export function splitLines(code) {
  return code.replace(/\r\n?/g, '\n').split('\n');
}

// Prefix every line with its number so the AI can refer to exact lines.
export function withLineNumbers(code) {
  const lines = splitLines(code);
  const width = String(lines.length).length;
  return lines.map((line, index) => `${String(index + 1).padStart(width, ' ')} | ${line}`).join('\n');
}

export function truncate(text, maxLength) {
  if (typeof text !== 'string') return '';
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
