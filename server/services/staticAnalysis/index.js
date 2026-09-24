// STATIC ANALYSIS ENGINE - entry point.
// Deterministic analysis: the same code always produces the same result.
//
//   code ──► Tree-sitter parser ──► syntax tree
//                                   ├─► syntax checker   (ERROR / MISSING nodes)
//                                   ├─► metrics          (functions, cyclomatic complexity, nesting)
//                                   ├─► common rules     (all languages)
//                                   └─► language rules   (Python / Java / C++ / ESLint for JavaScript)
import { parseCode } from './parser.js';
import { computeMetrics } from './metrics.js';
import { findSyntaxErrors } from './syntaxChecker.js';
import { runCommonRules } from './rules/commonRules.js';
import { runPythonRules } from './rules/pythonRules.js';
import { runJavaRules } from './rules/javaRules.js';
import { runCppRules } from './rules/cppRules.js';
import { runJavaScriptRules } from './rules/javascriptRules.js';
import { splitLines } from '../../utils/textUtils.js';
import { SEVERITY_RANK } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';

const LANGUAGE_RULES = {
  python: runPythonRules,
  java: runJavaRules,
  cpp: runCppRules,
  javascript: runJavaScriptRules, // ESLint
};

// One faulty rule must not break the whole analysis.
function safeRun(name, fn, ctx) {
  try {
    return fn(ctx);
  } catch (error) {
    logger.warn(`Static rule set "${name}" failed and was skipped`, { error: error.message });
    return [];
  }
}

function removeDuplicates(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.ruleId}:${issue.line}:${issue.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function analyzeCode(code, language) {
  const lines = splitLines(code);
  const tree = await parseCode(code, language);

  try {
    const metrics = computeMetrics(tree, lines, language);
    const ctx = { root: tree.rootNode, code, lines, language, metrics };

    // For JavaScript, ESLint reports syntax errors itself (with better messages).
    const languageIssues = safeRun(language, LANGUAGE_RULES[language], ctx);
    const syntaxIssues = language === 'javascript'
      ? languageIssues.filter((issue) => issue.type === 'Syntax Error')
      : findSyntaxErrors(tree, lines, language);
    const ruleIssues = languageIssues.filter((issue) => issue.type !== 'Syntax Error');

    // If the code does not parse, style/smell rules on a broken tree are unreliable.
    const syntaxValid = syntaxIssues.length === 0;
    const otherIssues = syntaxValid ? [...ruleIssues, ...safeRun('common', runCommonRules, ctx)] : [];

    const issues = removeDuplicates([...syntaxIssues, ...otherIssues]).sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.line - b.line,
    );

    return { syntaxValid, issues, metrics };
  } finally {
    tree.delete(); // free WebAssembly memory
  }
}
