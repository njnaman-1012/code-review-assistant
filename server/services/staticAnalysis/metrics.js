// Deterministic code metrics: size, functions, McCabe cyclomatic complexity
// and nesting depth. These numbers never come from the AI.
import { LANGUAGE_NODES, LOGICAL_OPERATORS } from './languageConfig.js';
import { findAll, walk, lineOf } from './parser.js';
import { operatorOf, functionName, functionBody, parameterCount, isElseIf } from './astUtils.js';

const COMMENT_PREFIX = {
  python: ['#'],
  java: ['//', '/*', '*', '*/'],
  cpp: ['//', '/*', '*', '*/'],
  javascript: ['//', '/*', '*', '*/'],
};

// Does this node add a decision point (an extra path through the code)?
function isDecisionPoint(node, language, decisionTypes) {
  if (decisionTypes.has(node.type)) {
    // `default:` labels are not decisions, only `case X:` labels are.
    if (language === 'java' && node.type === 'switch_label') return node.namedChildCount > 0;
    if (language === 'cpp' && node.type === 'case_statement') return Boolean(node.childForFieldName('value'));
    return true;
  }
  // && and || each create an extra path in C-like languages.
  if (node.type === 'binary_expression') return LOGICAL_OPERATORS.has(operatorOf(node));
  return false;
}

// Cyclomatic complexity (McCabe, 1976) = decision points + 1.
// Nested functions are measured separately, so we do not descend into them.
function cyclomaticComplexity(fnNode, language) {
  const nodes = LANGUAGE_NODES[language];
  const decisionTypes = new Set(nodes.decisions);
  const functionTypes = new Set(nodes.functions);
  let decisions = 0;

  walk(functionBody(fnNode), (node) => {
    if (node.id !== fnNode.id && functionTypes.has(node.type)) return false;
    if (isDecisionPoint(node, language, decisionTypes)) decisions += 1;
    return true;
  });
  return decisions + 1;
}

// Deepest level of nested control statements inside a function.
function maxNestingDepth(fnNode, language) {
  const nodes = LANGUAGE_NODES[language];
  const nestingTypes = new Set(nodes.nesting);
  const functionTypes = new Set(nodes.functions);
  let maxDepth = 0;

  function visit(node, depth) {
    let currentDepth = depth;
    if (nestingTypes.has(node.type) && !isElseIf(node)) {
      currentDepth += 1;
      maxDepth = Math.max(maxDepth, currentDepth);
    }
    for (const child of node.children) {
      if (!functionTypes.has(child.type)) visit(child, currentDepth);
    }
  }
  visit(functionBody(fnNode), 0);
  return maxDepth;
}

function countLines(allLines, language) {
  // A trailing newline at the end of the file is not an extra line.
  const lines = allLines.length > 1 && allLines[allLines.length - 1] === '' ? allLines.slice(0, -1) : allLines;
  const prefixes = COMMENT_PREFIX[language];
  let blank = 0;
  let comment = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') blank += 1;
    else if (prefixes.some((prefix) => trimmed.startsWith(prefix))) comment += 1;
  }
  return { totalLines: lines.length, blankLines: blank, commentLines: comment, codeLines: lines.length - blank - comment };
}

export function computeMetrics(tree, lines, language) {
  const nodes = LANGUAGE_NODES[language];
  const root = tree.rootNode;

  const functions = findAll(root, nodes.functions).map((fnNode) => {
    const startLine = lineOf(fnNode);
    const endLine = fnNode.endPosition.row + 1;
    return {
      name: functionName(fnNode, language),
      startLine,
      endLine,
      length: endLine - startLine + 1,
      parameters: parameterCount(fnNode, language),
      cyclomatic: cyclomaticComplexity(fnNode, language),
      maxNesting: maxNestingDepth(fnNode, language),
    };
  });

  const complexities = functions.map((fn) => fn.cyclomatic);
  const total = complexities.reduce((sum, value) => sum + value, 0);

  return {
    ...countLines(lines, language),
    classCount: findAll(root, nodes.classes).length,
    functionCount: functions.length,
    functions,
    maxCyclomatic: complexities.length ? Math.max(...complexities) : 0,
    averageCyclomatic: complexities.length ? Math.round((total / complexities.length) * 10) / 10 : 0,
    maxNesting: functions.length ? Math.max(...functions.map((fn) => fn.maxNesting)) : 0,
  };
}
