// REPORT SERVICE - turns a stored review into a downloadable report.
// HTML: printable (open it and press Ctrl+P -> "Save as PDF").
// Markdown: plain text that can be pasted into documentation.
import { SUPPORTED_LANGUAGES } from '../utils/constants.js';
import { escapeHtml as esc } from '../utils/textUtils.js';

const TITLE = 'Code Review Assistant - Review Report';

function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function languageLabel(language) {
  return SUPPORTED_LANGUAGES[language]?.label ?? language;
}

function reviewType(review) {
  return review.ai.status === 'completed' ? 'Automated code checks + AI review' : 'Automated code checks only (AI review unavailable)';
}

// ---------------------------------------------------------------- HTML

const STYLE = `
  :root { color-scheme: light; }
  html { background: #ffffff; }
  body { background: #ffffff; font-family: "Segoe UI", Arial, sans-serif; color: #1f2937; max-width: 960px; margin: 32px auto; padding: 0 24px; line-height: 1.55; }
  h1 { font-size: 26px; margin-bottom: 4px; } h2 { font-size: 19px; border-bottom: 2px solid #e5e7eb; padding-bottom: 4px; margin-top: 32px; }
  h3 { font-size: 15px; margin: 18px 0 6px; }
  .meta { color: #4b5563; font-size: 14px; } .meta span { margin-right: 18px; }
  pre { background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 6px; font-size: 12.5px; white-space: pre-wrap; word-break: break-word; }
  code { font-family: Consolas, "Courier New", monospace; }
  table { border-collapse: collapse; width: 100%; font-size: 13.5px; margin: 8px 0; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; } th { background: #f3f4f6; }
  .issue { border: 1px solid #e5e7eb; border-left: 5px solid #9ca3af; border-radius: 6px; padding: 10px 14px; margin: 10px 0; page-break-inside: avoid; }
  .CRITICAL { border-left-color: #b91c1c; } .HIGH { border-left-color: #ea580c; } .MEDIUM { border-left-color: #ca8a04; }
  .LOW { border-left-color: #2563eb; } .INFO { border-left-color: #6b7280; }
  .badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: #e5e7eb; margin-right: 6px; }
  .note { background: #fef3c7; border: 1px solid #fcd34d; padding: 8px 12px; border-radius: 6px; font-size: 13.5px; }
  .muted { color: #6b7280; } footer { margin-top: 40px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 10px; }
  @media print { body { margin: 0; } pre { background: #f8fafc; color: #111827; border: 1px solid #d1d5db; } h2 { page-break-after: avoid; } }
`;

function htmlList(items) {
  return items.length ? `<ol>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ol>` : '<p class="muted">None.</p>';
}

function htmlIssues(issues) {
  if (!issues.length) return '<p>No issues were detected.</p>';
  const rows = issues.map((issue) => `<tr><td>${esc(issue.id)}</td><td>${esc(issue.severity)}</td><td>${esc(issue.type)}</td>`
    + `<td>${issue.line ?? '-'}</td><td>${esc(issue.title)}</td><td>${issue.source === 'static' ? 'Static' : 'AI'}</td></tr>`).join('');
  const details = issues.map((issue) => `
    <div class="issue ${esc(issue.severity)}">
      <div><span class="badge">${esc(issue.severity)}</span><span class="badge">${esc(issue.type)}</span>
      <span class="badge">${issue.source === 'static' ? 'Static analysis' : 'AI analysis'}</span><span class="badge">${esc(issue.confidence)}</span></div>
      <h3>${esc(issue.id)}: ${esc(issue.title)}${issue.line ? ` (line ${issue.line})` : ''}</h3>
      ${issue.code ? `<pre><code>${esc(issue.code)}</code></pre>` : ''}
      <p><strong>Explanation:</strong> ${esc(issue.explanation)}</p>
      <p><strong>Why it matters:</strong> ${esc(issue.impact)}</p>
      <p><strong>Recommended fix:</strong> ${esc(issue.suggestion)}</p>
    </div>`).join('');
  return `<table><tr><th>ID</th><th>Severity</th><th>Type</th><th>Line</th><th>Issue</th><th>Source</th></tr>${rows}</table>${details}`;
}

export function generateHtmlReport(review) {
  const { quality, complexity, staticAnalysis, comparison, improvements } = review;
  const metrics = staticAnalysis.metrics ?? { functions: [] };

  const functionRows = (metrics.functions ?? []).map((fn) => `<tr><td>${esc(fn.name)}</td><td>${fn.startLine}-${fn.endLine}</td>`
    + `<td>${fn.parameters}</td><td>${fn.cyclomatic}</td><td>${fn.maxNesting}</td></tr>`).join('');

  const changeBlocks = (improvements.changes ?? []).map((change, index) => `
    <h3>${index + 1}. ${esc(change.change)}</h3>
    <table><tr><th>Original approach</th><td>${esc(change.original)}</td></tr>
    <tr><th>Improved approach</th><td>${esc(change.improved)}</td></tr>
    <tr><th>Reason</th><td>${esc(change.reason)}</td></tr>
    <tr><th>Benefit</th><td>${esc(change.benefit)}</td></tr></table>`).join('');

  const summary = improvements.summary;
  const summaryTable = summary ? `<table>
    <tr><th>Performance</th><td>${esc(summary.performance)}</td></tr><tr><th>Readability</th><td>${esc(summary.readability)}</td></tr>
    <tr><th>Complexity</th><td>${esc(summary.complexity)}</td></tr><tr><th>Security</th><td>${esc(summary.security)}</td></tr></table>` : '';

  const comparisonTable = comparison ? `<table>
    <tr><th>Metric</th><th>Original</th><th>Improved</th></tr>
    <tr><td>Syntax valid</td><td>${comparison.original.syntaxValid ? 'Yes' : 'No'}</td><td>${comparison.improved.syntaxValid ? 'Yes' : 'No'}</td></tr>
    <tr><td>Static-analysis issues</td><td>${comparison.original.staticIssueCount}</td><td>${comparison.improved.staticIssueCount}</td></tr>
    <tr><td>Lines of code</td><td>${comparison.original.codeLines}</td><td>${comparison.improved.codeLines}</td></tr>
    <tr><td>Functions</td><td>${comparison.original.functionCount}</td><td>${comparison.improved.functionCount}</td></tr>
    <tr><td>Highest cyclomatic complexity</td><td>${comparison.original.maxCyclomatic}</td><td>${comparison.improved.maxCyclomatic}</td></tr>
    <tr><td>Deepest nesting</td><td>${comparison.original.maxNesting}</td><td>${comparison.improved.maxNesting}</td></tr>
    </table>${htmlList(comparison.notes)}` : '<p class="muted">No improved code was generated for this review.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<title>Code Review Report #${review.id}</title><style>${STYLE}</style></head>
<body>
<h1>${TITLE}</h1>
<p class="meta"><span><strong>Review ID:</strong> #${review.id}</span><span><strong>Language:</strong> ${esc(languageLabel(review.language))}</span>
<span><strong>Date/Time:</strong> ${esc(formatDate(review.createdAt))}</span><span><strong>Quality score:</strong> ${quality.score}/100 (grade ${esc(quality.grade)})</span></p>
<p class="meta"><span><strong>Issues:</strong> ${review.issues.length}</span><span><strong>Review type:</strong> ${esc(reviewType(review))}</span></p>
${review.ai.message ? `<p class="note">${esc(review.ai.message)}</p>` : ''}

<h2>1. Original Code</h2><pre><code>${esc(review.originalCode)}</code></pre>
<h2>2. Code Summary</h2><p>${esc(review.summary)}</p>
<h2>3. Logic Explanation</h2>
${review.logic.explanation ? `<p>${esc(review.logic.explanation)}</p>` : '<p class="muted">Not available (requires AI analysis).</p>'}
${review.logic.steps?.length ? `<h3>Step-by-step</h3>${htmlList(review.logic.steps)}` : ''}
${review.logic.keyComponents?.length ? `<h3>Key components</h3><table><tr><th>Name</th><th>Kind</th><th>Description</th></tr>${review.logic.keyComponents
    .map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.kind)}</td><td>${esc(c.description)}</td></tr>`).join('')}</table>` : ''}
<h2>4. Issues Detected (${review.issues.length})</h2>${htmlIssues(review.issues)}
<h2>5. Suggestions</h2>${review.suggestions.length ? `<ol>${review.suggestions
    .map((s) => `<li><strong>${esc(s.title)}</strong> <span class="badge">${esc(s.priority)} priority</span><br>${esc(s.description)}</li>`).join('')}</ol>` : '<p class="muted">None.</p>'}
<h2>6. Improved Code</h2>${review.improvedCode ? `<pre><code>${esc(review.improvedCode)}</code></pre>` : '<p class="muted">Not available (requires AI analysis).</p>'}
<h2>7. Explanation of Improvements</h2>${changeBlocks || '<p class="muted">Not available.</p>'}${summaryTable}
<h2>8. Complexity Analysis</h2>
<table><tr><th></th><th>Time</th><th>Space</th></tr>
<tr><th>Original</th><td>${esc(complexity.originalTime)}</td><td>${esc(complexity.originalSpace)}</td></tr>
<tr><th>Improved</th><td>${esc(complexity.improvedTime)}</td><td>${esc(complexity.improvedSpace)}</td></tr></table>
<p>${esc(complexity.explanation)}</p>
${functionRows ? `<h3>Cyclomatic complexity per function (static analysis)</h3><table><tr><th>Function</th><th>Lines</th><th>Parameters</th><th>Cyclomatic</th><th>Max nesting</th></tr>${functionRows}</table>` : ''}
<h2>9. Original vs Improved</h2>${comparisonTable}
<h2>10. Final Summary</h2><p>${esc(review.finalSummary)}</p>
<footer>Generated by the Code Review Assistant on ${esc(formatDate(new Date().toISOString()))}.
Static-analysis findings are deterministic; AI findings are suggestions and may be wrong. The code was analysed, not executed.
This report supports - but does not replace - human review and testing.</footer>
</body></html>`;
}

// ------------------------------------------------------------ Markdown

function fence(code, language) {
  return `\`\`\`${language === 'cpp' ? 'cpp' : language}\n${code}\n\`\`\``;
}

export function generateMarkdownReport(review) {
  const { quality, complexity, comparison, improvements } = review;
  const out = [];
  out.push(`# ${TITLE}`, '');
  out.push(`- **Review ID:** #${review.id}`, `- **Language:** ${languageLabel(review.language)}`,
    `- **Date/Time:** ${formatDate(review.createdAt)}`, `- **Quality score:** ${quality.score}/100 (grade ${quality.grade})`,
    `- **Issues:** ${review.issues.length}`, `- **Review type:** ${reviewType(review)}`, '');
  if (review.ai.message) out.push(`> ${review.ai.message}`, '');

  out.push('## 1. Original Code', '', fence(review.originalCode, review.language), '');
  out.push('## 2. Code Summary', '', review.summary, '');
  out.push('## 3. Logic Explanation', '', review.logic.explanation || '_Not available (requires AI analysis)._', '');
  review.logic.steps?.forEach((step, index) => out.push(`${index + 1}. ${step}`));
  out.push('');

  out.push(`## 4. Issues Detected (${review.issues.length})`, '');
  for (const issue of review.issues) {
    out.push(`### ${issue.id}: ${issue.title}`,
      `**Severity:** ${issue.severity} | **Type:** ${issue.type} | **Line:** ${issue.line ?? '-'} | **Source:** ${issue.source === 'static' ? 'Static analysis' : 'AI analysis'} | **Confidence:** ${issue.confidence}`, '');
    if (issue.code) out.push(fence(issue.code, review.language), '');
    out.push(`- **Explanation:** ${issue.explanation}`, `- **Why it matters:** ${issue.impact}`, `- **Recommended fix:** ${issue.suggestion}`, '');
  }

  out.push('## 5. Suggestions', '');
  review.suggestions.forEach((s, index) => out.push(`${index + 1}. **${s.title}** (${s.priority} priority) - ${s.description}`));
  out.push('');

  out.push('## 6. Improved Code', '', review.improvedCode ? fence(review.improvedCode, review.language) : '_Not available._', '');
  out.push('## 7. Explanation of Improvements', '');
  (improvements.changes ?? []).forEach((change, index) => out.push(
    `${index + 1}. **${change.change}**`, `   - Original: ${change.original}`, `   - Improved: ${change.improved}`,
    `   - Reason: ${change.reason}`, `   - Benefit: ${change.benefit}`,
  ));
  if (improvements.summary) {
    out.push('', `- **Performance:** ${improvements.summary.performance}`, `- **Readability:** ${improvements.summary.readability}`,
      `- **Complexity:** ${improvements.summary.complexity}`, `- **Security:** ${improvements.summary.security}`);
  }
  out.push('');

  out.push('## 8. Complexity Analysis', '', '| | Time | Space |', '|---|---|---|',
    `| Original | ${complexity.originalTime} | ${complexity.originalSpace} |`,
    `| Improved | ${complexity.improvedTime} | ${complexity.improvedSpace} |`, '', complexity.explanation, '');

  out.push('## 9. Original vs Improved', '');
  if (comparison) {
    out.push('| Metric | Original | Improved |', '|---|---|---|',
      `| Syntax valid | ${comparison.original.syntaxValid ? 'Yes' : 'No'} | ${comparison.improved.syntaxValid ? 'Yes' : 'No'} |`,
      `| Static-analysis issues | ${comparison.original.staticIssueCount} | ${comparison.improved.staticIssueCount} |`,
      `| Highest cyclomatic complexity | ${comparison.original.maxCyclomatic} | ${comparison.improved.maxCyclomatic} |`,
      `| Deepest nesting | ${comparison.original.maxNesting} | ${comparison.improved.maxNesting} |`, '');
    comparison.notes.forEach((note) => out.push(`- ${note}`));
  } else {
    out.push('_No improved code was generated for this review._');
  }
  out.push('', '## 10. Final Summary', '', review.finalSummary, '', '---',
    '_Generated by the Code Review Assistant. The code was analysed, not executed. AI findings are suggestions; this report supports but does not replace human review and testing._');
  return out.join('\n');
}
