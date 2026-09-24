// Shared vocabulary of the system. The same values are used by the static
// analyzer, the AI prompt, the validator, the database and the frontend.

export const SUPPORTED_LANGUAGES = {
  python: { label: 'Python', extensions: ['.py'] },
  java: { label: 'Java', extensions: ['.java'] },
  cpp: { label: 'C++', extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.h'] },
  javascript: { label: 'JavaScript', extensions: ['.js', '.mjs', '.cjs', '.jsx'] },
};

// Friendly names users might send instead of the canonical key.
export const LANGUAGE_ALIASES = {
  py: 'python',
  python3: 'python',
  'c++': 'cpp',
  cplusplus: 'cpp',
  js: 'javascript',
  node: 'javascript',
  nodejs: 'javascript',
};

// Ordered from most to least severe.
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export const SEVERITY_RANK = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };

export const ISSUE_TYPES = [
  'Syntax Error',
  'Logical Error',
  'Runtime Risk',
  'Security Issue',
  'Code Smell',
  'Performance Issue',
  'Maintainability Issue',
  'Readability Issue',
  'Coding Standard Issue',
];

// How sure we are that an issue is real.
//  confirmed - found by a parser/linter rule, or certain from the code
//  likely    - strong evidence but not proven
//  possible  - depends on inputs or context the reviewer cannot see
export const CONFIDENCE_LEVELS = ['confirmed', 'likely', 'possible'];

export const ISSUE_SOURCES = { STATIC: 'static', AI: 'ai' };

export const AI_STATUS = {
  COMPLETED: 'completed',
  UNAVAILABLE: 'unavailable', // no provider configured
  FAILED: 'failed', // provider configured but the call failed
};

export function normalizeLanguage(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  const canonical = LANGUAGE_ALIASES[key] || key;
  return SUPPORTED_LANGUAGES[canonical] ? canonical : null;
}
