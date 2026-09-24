// Finds syntax errors. Tree-sitter marks code it cannot understand with
// ERROR nodes and inserts MISSING nodes where a token (like ';') is absent.
import { lineOf } from './parser.js';
import { lineText } from './astUtils.js';
import { SUPPORTED_LANGUAGES } from '../../utils/constants.js';

const MAX_SYNTAX_ISSUES = 5; // later errors are usually side effects of the first

function collectProblemNodes(root) {
  const problems = [];
  const stack = [root];
  while (stack.length && problems.length < MAX_SYNTAX_ISSUES) {
    const node = stack.pop();
    if (node.isMissing || node.isError) {
      problems.push(node);
      continue; // do not report errors nested inside an error
    }
    if (node.hasError) {
      for (let i = node.childCount - 1; i >= 0; i -= 1) stack.push(node.child(i));
    }
  }
  return problems.sort((a, b) => a.startIndex - b.startIndex);
}

export function findSyntaxErrors(tree, lines, language) {
  if (!tree.rootNode.hasError) return [];
  const label = SUPPORTED_LANGUAGES[language].label;

  return collectProblemNodes(tree.rootNode).map((node) => {
    const line = lineOf(node);
    const code = lineText(lines, line);

    if (node.isMissing) {
      return {
        ruleId: 'syntax-missing-token',
        title: `Missing "${node.type}"`,
        type: 'Syntax Error',
        severity: 'CRITICAL',
        line,
        code,
        explanation: `The ${label} parser expected "${node.type}" near line ${line} but did not find it.`,
        impact: 'The program will not compile or run until the syntax error is fixed.',
        suggestion: `Add the missing "${node.type}" (check the end of this line and the line before it).`,
        confidence: 'confirmed',
      };
    }

    return {
      ruleId: 'syntax-error',
      title: 'Invalid syntax',
      type: 'Syntax Error',
      severity: 'CRITICAL',
      line,
      code,
      explanation:
        `The ${label} parser could not understand the code starting at line ${line}. ` +
        'This is usually caused by a missing or extra bracket, parenthesis, quote, colon or operator.',
      impact: 'The program will not compile or run until the syntax error is fixed.',
      suggestion: 'Check the brackets, parentheses, quotes and punctuation on this line and the line above it.',
      // C++ macros can confuse the parser, so we are slightly less certain there.
      confidence: language === 'cpp' ? 'likely' : 'confirmed',
    };
  });
}
