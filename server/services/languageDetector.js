// LANGUAGE DETECTOR - guesses the language of a piece of code from
// characteristic patterns. Used to warn the user when the selected language
// does not match the code (e.g. Java code submitted as Python).

const SIGNALS = {
  python: [
    [/^\s*def\s+\w+\s*\(.*\)\s*(->\s*[\w\[\], .]+)?\s*:\s*$/m, 4],
    [/^\s*from\s+[\w.]+\s+import\s+/m, 3],
    [/^\s*import\s+[\w.]+(\s+as\s+\w+)?\s*$/m, 2],
    [/^\s*(elif|except|finally)\b.*:\s*$/m, 3],
    [/^\s*class\s+\w+(\(.*\))?\s*:\s*$/m, 3],
    [/\bprint\s*\(/, 1],
    [/\bself\b/, 2],
    [/__name__\s*==\s*['"]__main__['"]/, 4],
    [/\b(None|True|False)\b/, 1],
    [/^\s*(if|for|while)\s+.*:\s*$/m, 2],
  ],
  java: [
    [/\bpublic\s+static\s+void\s+main\s*\(\s*String/, 6],
    [/\bSystem\.out\.print(ln)?\s*\(/, 5],
    [/^\s*import\s+java\./m, 5],
    [/\b(public|private|protected)\s+(static\s+)?(final\s+)?[\w<>[\]]+\s+\w+\s*[(;=]/, 3],
    [/\bpublic\s+class\s+\w+/, 3],
    [/\bString\[\]/, 2],
    [/@Override\b/, 3],
    [/\bnew\s+(ArrayList|HashMap|Scanner|StringBuilder)\b/, 3],
  ],
  cpp: [
    [/^\s*#include\s*[<"]/m, 5],
    [/\bstd::/, 4],
    [/\busing\s+namespace\s+std\b/, 5],
    [/\bcout\s*<</, 4],
    [/\bcin\s*>>/, 4],
    [/\b(vector|map|set)\s*</, 2],
    [/\bint\s+main\s*\(/, 2],
    [/->\w+/, 1],
    [/\b(nullptr|template\s*<|delete\s*\[?)/, 2],
  ],
  javascript: [
    [/\b(const|let)\s+\w+\s*=/, 3],
    [/\bvar\s+\w+\s*=/, 2],
    [/\bfunction\s*\w*\s*\(/, 2],
    [/=>\s*[{(\w]/, 2],
    [/\bconsole\.(log|error|warn)\s*\(/, 5],
    [/\brequire\s*\(\s*['"]/, 4],
    [/^\s*import\s+.*\s+from\s+['"]/m, 4],
    [/\bexport\s+(default|const|function|class)\b/, 4],
    [/\b(document|window)\./, 3],
    [/===|!==/, 2],
  ],
};

export function detectLanguage(code) {
  const scores = {};
  for (const [language, signals] of Object.entries(SIGNALS)) {
    scores[language] = signals.reduce((sum, [pattern, weight]) => sum + (pattern.test(code) ? weight : 0), 0);
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestLanguage, bestScore] = ranked[0];
  const total = ranked.reduce((sum, [, score]) => sum + score, 0);

  if (bestScore < 3) return { language: null, confidence: 0, scores };
  return {
    language: bestLanguage,
    confidence: Math.round((bestScore / total) * 100) / 100,
    scores,
  };
}

// Compares the user's choice with the detected language.
export function checkLanguageMatch(code, selectedLanguage) {
  const detection = detectLanguage(code);
  const mismatch = Boolean(
    detection.language &&
    detection.language !== selectedLanguage &&
    detection.confidence >= 0.6 &&
    detection.scores[detection.language] >= 6 &&
    detection.scores[selectedLanguage] < 3,
  );
  return {
    selected: selectedLanguage,
    detected: detection.language,
    confidence: detection.confidence,
    mismatch,
  };
}
