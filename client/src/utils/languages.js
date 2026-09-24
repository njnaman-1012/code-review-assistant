// Supported languages (must match server/utils/constants.js).
export const LANGUAGES = [
  { value: 'python', label: 'Python', monaco: 'python', extensions: ['.py'], fileExtension: 'py' },
  { value: 'java', label: 'Java', monaco: 'java', extensions: ['.java'], fileExtension: 'java' },
  { value: 'cpp', label: 'C++', monaco: 'cpp', extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.h'], fileExtension: 'cpp' },
  { value: 'javascript', label: 'JavaScript', monaco: 'javascript', extensions: ['.js', '.mjs', '.cjs', '.jsx'], fileExtension: 'js' },
];

export const MAX_CODE_CHARS = 20000;
export const MAX_FILE_BYTES = 100 * 1024; // 100 KB
export const ACCEPTED_EXTENSIONS = LANGUAGES.flatMap((language) => language.extensions);

export function getLanguage(value) {
  return LANGUAGES.find((language) => language.value === value) ?? null;
}

export function languageLabel(value) {
  return getLanguage(value)?.label ?? value;
}

export function languageFromFilename(filename) {
  const lower = filename.toLowerCase();
  return LANGUAGES.find((language) => language.extensions.some((ext) => lower.endsWith(ext)))?.value ?? null;
}

// Light-weight guess used for the "this looks like Java" hint.
// (The server runs a more detailed detector.)
const HINTS = {
  python: [/^\s*def\s+\w+\s*\(.*\)\s*:/m, /^\s*(elif|except)\b.*:\s*$/m, /^\s*from\s+[\w.]+\s+import\s/m, /\bself\b/, /__name__\s*==/],
  java: [/\bpublic\s+static\s+void\s+main/, /System\.out\.print/, /^\s*import\s+java\./m, /\bpublic\s+class\s+\w+/],
  cpp: [/^\s*#include\s*[<"]/m, /\bstd::/, /\busing\s+namespace\s+std\b/, /\bcout\s*<</, /\bcin\s*>>/],
  javascript: [/\bconsole\.log\s*\(/, /\b(const|let)\s+\w+\s*=/, /=>\s*[{(\w]/, /\brequire\s*\(\s*['"]/, /\bfunction\s+\w+\s*\(/],
};

export function guessLanguage(code) {
  if (!code || code.trim().length < 20) return null;
  let best = null;
  let bestScore = 0;
  for (const [language, patterns] of Object.entries(HINTS)) {
    const score = patterns.filter((pattern) => pattern.test(code)).length;
    if (score > bestScore) {
      best = language;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}
