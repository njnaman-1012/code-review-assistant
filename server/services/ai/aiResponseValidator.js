// Validates the AI's answer before it is used anywhere.
//   raw text/object ──► parse JSON ──► normalize small variations ──► Zod schema check
// If anything essential is missing, an AiServiceError is thrown and the
// review service falls back to static analysis only.
import { aiReviewSchema, aiCorrectionSchema, aiImprovementSchema } from './reviewSchema.js';
import { ISSUE_TYPES, SEVERITIES, CONFIDENCE_LEVELS, SUPPORTED_LANGUAGES, normalizeLanguage } from '../../utils/constants.js';
import { AiServiceError } from '../../utils/AppError.js';

const SEVERITY_SYNONYMS = {
  BLOCKER: 'CRITICAL', FATAL: 'CRITICAL', ERROR: 'HIGH', MAJOR: 'HIGH',
  WARNING: 'MEDIUM', MODERATE: 'MEDIUM', MINOR: 'LOW', TRIVIAL: 'LOW', NOTE: 'INFO', INFORMATION: 'INFO',
};

const TYPE_KEYWORDS = [
  [/syntax/i, 'Syntax Error'],
  [/secur|vulnerab|inject/i, 'Security Issue'],
  [/runtime|exception|crash|null|overflow|leak/i, 'Runtime Risk'],
  [/logic|bug|correct/i, 'Logical Error'],
  [/perf|efficien|speed|slow/i, 'Performance Issue'],
  [/smell|duplicat/i, 'Code Smell'],
  [/read|naming|clarity/i, 'Readability Issue'],
  [/standard|convention|style|format|lint/i, 'Coding Standard Issue'],
  [/maintain|design|structure/i, 'Maintainability Issue'],
];

function text(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

// Removes ```lang fences if the model wrapped the code in markdown.
export function stripCodeFences(code) {
  const trimmed = text(code);
  const match = trimmed.match(/^```[\w+#-]*\s*\n([\s\S]*?)\n?```\s*$/);
  return match ? match[1] : trimmed;
}

// Removes "12 | " prefixes when the model copied lines from the numbered listing.
export function stripLineNumbers(text) {
  const lines = text.split('\n');
  const nonEmpty = lines.filter((line) => line.trim());
  const numbered = nonEmpty.length > 0 && nonEmpty.every((line) => /^\s*\d+ \| ?/.test(line));
  return numbered ? lines.map((line) => line.replace(/^\s*\d+ \| ?/, '')).join('\n') : text;
}

// Accepts a JSON string (optionally wrapped in ```json fences) or an object.
export function parseAiJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  const content = text(raw);
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new AiServiceError('AI_INVALID_RESPONSE', 'The AI response did not contain JSON.');
  }
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new AiServiceError('AI_INVALID_RESPONSE', 'The AI response was not valid JSON.');
  }
}

function normalizeSeverity(value) {
  const upper = text(value).toUpperCase();
  if (SEVERITIES.includes(upper)) return upper;
  return SEVERITY_SYNONYMS[upper] || 'MEDIUM';
}

function normalizeType(value) {
  const raw = text(value);
  const exact = ISSUE_TYPES.find((type) => type.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const match = TYPE_KEYWORDS.find(([pattern]) => pattern.test(raw));
  return match ? match[1] : 'Maintainability Issue';
}

function normalizeLine(value) {
  const number = typeof value === 'number' ? value : parseInt(text(value).match(/\d+/)?.[0] ?? '', 10);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeIssue(issue) {
  const confidence = text(issue?.confidence).toLowerCase();
  return {
    title: text(issue?.title) || 'Unnamed issue',
    type: normalizeType(issue?.type),
    severity: normalizeSeverity(issue?.severity),
    line: normalizeLine(issue?.line),
    code: stripLineNumbers(stripCodeFences(issue?.code)),
    explanation: text(issue?.explanation),
    impact: text(issue?.impact),
    suggestion: text(issue?.suggestion),
    confidence: CONFIDENCE_LEVELS.includes(confidence) ? confidence : 'likely',
  };
}

function normalize(data) {
  const complexity = data.complexity ?? {};
  const summary = data.improvementSummary ?? {};
  const score = Number(data.qualityScore);

  return {
    summary: text(data.summary),
    logicExplanation: text(data.logicExplanation),
    logicSteps: list(data.logicSteps).map((step) => text(step?.description ?? step)).filter(Boolean),
    keyComponents: list(data.keyComponents).map((component) => ({
      name: text(component?.name),
      kind: text(component?.kind) || 'component',
      description: text(component?.description),
    })).filter((component) => component.name),
    issues: list(data.issues).map(normalizeIssue).filter((issue) => issue.explanation || issue.title !== 'Unnamed issue'),
    qualityScore: data.qualityScore === null || data.qualityScore === undefined || Number.isNaN(score)
      ? null
      : Math.min(100, Math.max(0, Math.round(score))),
    suggestions: list(data.suggestions).map((item) => (typeof item === 'string'
      ? { title: item, description: '', priority: 'medium' }
      : {
        title: text(item?.title),
        description: text(item?.description),
        priority: ['high', 'medium', 'low'].includes(text(item?.priority).toLowerCase()) ? text(item.priority).toLowerCase() : 'medium',
      })).filter((item) => item.title || item.description),
    improvedCode: stripLineNumbers(stripCodeFences(data.improvedCode)),
    improvementExplanation: list(data.improvementExplanation).map((item) => (typeof item === 'string'
      ? { change: item, original: '', improved: '', reason: '', benefit: '' }
      : {
        change: text(item?.change),
        original: text(item?.original),
        improved: text(item?.improved),
        reason: text(item?.reason),
        benefit: text(item?.benefit),
      })).filter((item) => item.change),
    improvementSummary: {
      performance: text(summary.performance),
      readability: text(summary.readability),
      complexity: text(summary.complexity),
      security: text(summary.security),
    },
    complexity: {
      originalTime: text(complexity.originalTime) || 'Not determined',
      originalSpace: text(complexity.originalSpace) || 'Not determined',
      improvedTime: text(complexity.improvedTime) || 'Not determined',
      improvedSpace: text(complexity.improvedSpace) || 'Not determined',
      explanation: text(complexity.explanation),
    },
    finalSummary: text(data.finalSummary),
  };
}

export function validateAiReview(raw) {
  const data = parseAiJson(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AiServiceError('AI_INVALID_RESPONSE', 'The AI response was not a JSON object.');
  }

  const result = aiReviewSchema.safeParse(normalize(data));
  if (!result.success) {
    throw new AiServiceError('AI_INVALID_RESPONSE', 'The AI response did not match the expected review format.');
  }

  // The fields every review needs in order to be useful.
  const review = result.data;
  const missing = ['summary', 'logicExplanation', 'finalSummary'].filter((field) => !review[field]);
  if (missing.length) {
    throw new AiServiceError('AI_INVALID_RESPONSE', `The AI response is missing required content: ${missing.join(', ')}.`);
  }
  return review;
}

// ---- "Fix / Correct Code" and "Improve Code" answers

const CODE_ACTION_SCHEMAS = {
  correct: { schema: aiCorrectionSchema, field: 'correctedCode' },
  improve: { schema: aiImprovementSchema, field: 'improvedCode' },
};

function normalizeChange(item) {
  if (typeof item === 'string') return { title: item.trim(), explanation: '', problemSolved: '', lines: '' };
  const lines = item?.lines ?? item?.line;
  return {
    title: text(item?.title ?? item?.change),
    explanation: text(item?.explanation ?? item?.why ?? item?.reason),
    problemSolved: text(item?.problemSolved ?? item?.problem ?? item?.benefit ?? item?.impact),
    lines: Array.isArray(lines) ? lines.join(', ') : text(lines),
  };
}

// Returns { action, language, correctedCode | improvedCode, code, changes, summary }.
// `code` is the same complete source file under a common name.
export function validateCodeAction(raw, { action, language }) {
  const { schema, field } = CODE_ACTION_SCHEMAS[action];
  const data = parseAiJson(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AiServiceError('AI_INVALID_RESPONSE', 'The AI response was not a JSON object.');
  }

  const rawCode = data[field] ?? data.code;
  const code = typeof rawCode === 'string' ? stripLineNumbers(stripCodeFences(rawCode)) : '';
  if (!code.trim()) {
    throw new AiServiceError('AI_EMPTY_CODE', `The AI response did not contain the ${field === 'correctedCode' ? 'corrected' : 'improved'} code.`);
  }

  const result = schema.safeParse({
    action,
    language: text(data.language) || language,
    [field]: code,
    changes: list(data.changes).map(normalizeChange).filter((change) => change.title || change.explanation),
    summary: text(data.summary),
  });
  if (!result.success) {
    throw new AiServiceError('AI_INVALID_RESPONSE', 'The AI response did not match the expected format.');
  }

  // The language must be preserved. (The code itself is checked separately.)
  const reported = normalizeLanguage(result.data.language);
  if (reported && reported !== language) {
    throw new AiServiceError('AI_WRONG_LANGUAGE', `The code was returned in ${SUPPORTED_LANGUAGES[reported].label} instead of ${SUPPORTED_LANGUAGES[language].label}.`);
  }
  return { ...result.data, language, code };
}
