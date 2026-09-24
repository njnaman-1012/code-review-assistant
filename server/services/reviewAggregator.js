// REVIEW AGGREGATOR - combines the static-analysis result and the AI result
// into one review object (the shape stored in the database and sent to the
// frontend). It also removes duplicates and calculates the quality score.
import { SEVERITY_RANK, SUPPORTED_LANGUAGES, AI_STATUS } from '../utils/constants.js';
import { splitLines } from '../utils/textUtils.js';

// Deterministic scoring formula (explainable in a viva):
//   score = 100 - (20 x CRITICAL + 10 x HIGH + 5 x MEDIUM + 2 x LOW)
// "possible" issues count half, the score never goes below 0.
const PENALTY = { CRITICAL: 20, HIGH: 10, MEDIUM: 5, LOW: 2, INFO: 0 };
const CONFIDENCE_RANK = { confirmed: 3, likely: 2, possible: 1 };

export function calculateQualityScore(issues) {
  const penalty = issues.reduce(
    (sum, issue) => sum + PENALTY[issue.severity] * (issue.confidence === 'possible' ? 0.5 : 1),
    0,
  );
  return Math.max(0, Math.round(100 - penalty));
}

export function gradeFor(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function words(text) {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
}

function similarTitles(a, b) {
  const wordsA = words(a);
  const wordsB = words(b);
  if (!wordsA.size || !wordsB.size) return false;
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
  return shared / Math.min(wordsA.size, wordsB.size) >= 0.6;
}

// An AI issue is a duplicate if static analysis already reported the same
// kind of problem on (almost) the same line.
function isDuplicate(aiIssue, staticIssues) {
  return staticIssues.some((staticIssue) => {
    const sameLine = aiIssue.line !== null && Math.abs(aiIssue.line - staticIssue.line) <= 1;
    const sameKind = aiIssue.type === staticIssue.type || similarTitles(aiIssue.title, staticIssue.title);
    return (sameLine && sameKind) || (aiIssue.line === null && similarTitles(aiIssue.title, staticIssue.title));
  });
}

const UNDEFINED_CLAIM = /\b(undefined|not defined|undeclared|does not exist|never defined|is missing)\b/i;

function normalizeCode(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

// AI CLAIM VERIFICATION - deterministic checks of an AI issue against the
// real code and the parser's results. Issues that fail a check are kept but
// downgraded to "possible" with a note, so weak or hallucinating models
// cannot present invented problems as confirmed facts.
export function verifyAiIssue(issue, { syntaxValid, lines = [], definedFunctions = new Set() }) {
  const verified = { ...issue };
  const notes = [];

  // 1. The parser is the authority on syntax errors.
  if (issue.type === 'Syntax Error' && syntaxValid) {
    notes.push('the parser did not detect a syntax error here');
  }

  // 2. The line number must exist.
  if (issue.line !== null && lines.length && issue.line > lines.length) {
    notes.push(`line ${issue.line} does not exist (the code has ${lines.length} lines)`);
    verified.line = null;
  }

  // 3. The quoted code must really appear in the submission.
  const firstQuotedLine = normalizeCode(issue.code.split('\n').find((line) => line.trim()) ?? '');
  if (firstQuotedLine && lines.length && !normalizeCode(lines.join('\n')).includes(firstQuotedLine)) {
    notes.push('the quoted code was not found in the submitted code');
  }

  // 4. "X is undefined" is contradicted if the parser found a definition of X.
  if (UNDEFINED_CLAIM.test(`${issue.title} ${issue.explanation}`)) {
    const mentioned = new Set([...`${issue.title} ${issue.code}`.matchAll(/([A-Za-z_]\w*)\s*\(/g)].map((match) => match[1]));
    const defined = [...mentioned].filter((name) => definedFunctions.has(name));
    if (defined.length) notes.push(`static analysis found a definition of ${defined.join(', ')}`);
  }

  if (notes.length) {
    verified.confidence = 'possible';
    verified.explanation = `${issue.explanation} (Automatic check: ${notes.join('; ')} - treat this AI finding with caution.)`;
  }
  return verified;
}

export function mergeIssues(staticIssues, aiIssues, context) {
  const merged = staticIssues.map((issue) => ({ ...issue, source: 'static' }));

  for (const issue of aiIssues) {
    if (isDuplicate(issue, staticIssues)) continue;
    merged.push({ ...verifyAiIssue(issue, context), source: 'ai', ruleId: null });
  }

  merged.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    || CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
    || (a.line ?? Infinity) - (b.line ?? Infinity));

  return merged.map((issue, index) => ({ id: `ISSUE-${index + 1}`, ...issue }));
}

export function countIssues(issues) {
  const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  const bySource = { static: 0, ai: 0 };
  for (const issue of issues) {
    bySeverity[issue.severity] += 1;
    bySource[issue.source] += 1;
  }
  return { total: issues.length, bySeverity, bySource };
}

function metricsSummary(staticResult) {
  const { metrics } = staticResult;
  return {
    syntaxValid: staticResult.syntaxValid,
    staticIssueCount: staticResult.issues.length,
    totalLines: metrics.totalLines,
    codeLines: metrics.codeLines,
    functionCount: metrics.functionCount,
    maxCyclomatic: metrics.maxCyclomatic,
    averageCyclomatic: metrics.averageCyclomatic,
    maxNesting: metrics.maxNesting,
  };
}

// Original vs improved code, both measured by the same static analyzer.
export function buildComparison(originalStatic, improvedStatic) {
  if (!improvedStatic) return null;
  const original = metricsSummary(originalStatic);
  const improved = metricsSummary(improvedStatic);
  const notes = [];

  if (!improved.syntaxValid) {
    notes.push('Warning: the parser found syntax errors in the improved code. Review it carefully before using it.');
  } else if (!original.syntaxValid) {
    notes.push('The syntax errors in the original code are fixed in the improved version.');
  }
  if (improved.staticIssueCount !== original.staticIssueCount) {
    notes.push(`Static-analysis issues changed from ${original.staticIssueCount} to ${improved.staticIssueCount}.`);
  }
  if (improved.maxCyclomatic !== original.maxCyclomatic) {
    notes.push(`Highest cyclomatic complexity changed from ${original.maxCyclomatic} to ${improved.maxCyclomatic}.`);
  }
  if (improved.maxNesting !== original.maxNesting) {
    notes.push(`Deepest nesting changed from ${original.maxNesting} to ${improved.maxNesting} levels.`);
  }
  notes.push('These checks are static: the improved code has not been executed, so test it before relying on it.');

  return { original, improved, notes };
}

function staticSuggestions(issues) {
  const seen = new Set();
  const suggestions = [];
  for (const issue of issues) {
    if (seen.has(issue.ruleId) || !issue.suggestion) continue;
    seen.add(issue.ruleId);
    suggestions.push({
      title: issue.title,
      description: issue.suggestion,
      priority: SEVERITY_RANK[issue.severity] >= 4 ? 'high' : SEVERITY_RANK[issue.severity] === 3 ? 'medium' : 'low',
    });
  }
  return suggestions.slice(0, 8);
}

function staticKeyComponents(metrics) {
  return metrics.functions.map((fn) => ({
    name: fn.name,
    kind: 'function',
    description: `Lines ${fn.startLine}-${fn.endLine}, ${fn.parameters} parameter(s), cyclomatic complexity ${fn.cyclomatic}.`,
  }));
}

export function aggregateReview({ language, code, staticResult, languageCheck, aiResult, ai, improvedStaticResult }) {
  const label = SUPPORTED_LANGUAGES[language].label;
  const aiReview = aiResult?.review ?? null;
  const issues = mergeIssues(staticResult.issues, aiReview?.issues ?? [], {
    syntaxValid: staticResult.syntaxValid,
    lines: splitLines(code).filter((line, index, all) => index < all.length - 1 || line !== ''),
    definedFunctions: new Set(staticResult.metrics.functions.map((fn) => fn.name.split(/::|\./).pop())),
  });
  const counts = countIssues(issues);
  const score = calculateQualityScore(issues);

  const staticSummary = `Static analysis of this ${label} code found ${staticResult.issues.length} issue(s) `
    + `in ${staticResult.metrics.totalLines} line(s) and ${staticResult.metrics.functionCount} function(s).`;
  const aiNote = ai.status === AI_STATUS.COMPLETED ? '' : ` AI analysis was not available: ${ai.message}`;

  return {
    language,
    originalCode: code,
    summary: aiReview?.summary || `${staticSummary}${aiNote}`,
    logic: {
      explanation: aiReview?.logicExplanation ?? '',
      steps: aiReview?.logicSteps ?? [],
      keyComponents: aiReview?.keyComponents?.length ? aiReview.keyComponents : staticKeyComponents(staticResult.metrics),
    },
    issues,
    quality: {
      score,
      grade: gradeFor(score),
      aiScore: aiReview?.qualityScore ?? null,
      formula: '100 - (20 x Critical + 10 x High + 5 x Medium + 2 x Low); "possible" issues count half',
      counts,
    },
    suggestions: aiReview?.suggestions?.length ? aiReview.suggestions : staticSuggestions(staticResult.issues),
    improvedCode: aiReview?.improvedCode ?? '',
    improvements: {
      changes: aiReview?.improvementExplanation ?? [],
      summary: aiReview?.improvementSummary ?? null,
    },
    complexity: aiReview?.complexity ?? {
      originalTime: 'Not determined',
      originalSpace: 'Not determined',
      improvedTime: 'Not determined',
      improvedSpace: 'Not determined',
      explanation: 'Big-O analysis is produced by the AI engine, which was not available for this review. '
        + 'The cyclomatic complexity values below were measured by static analysis.',
    },
    staticAnalysis: {
      syntaxValid: staticResult.syntaxValid,
      metrics: staticResult.metrics,
      issueCount: staticResult.issues.length,
      languageCheck,
    },
    comparison: buildComparison(staticResult, improvedStaticResult),
    finalSummary: aiReview?.finalSummary
      || `${staticSummary} The overall static quality score is ${score}/100 (grade ${gradeFor(score)}).${aiNote}`,
    ai,
  };
}
