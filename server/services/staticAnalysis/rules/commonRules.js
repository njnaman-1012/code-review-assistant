// Rules that apply to every supported language. They use the metrics and
// the syntax tree, so the results are deterministic and repeatable.
import { LANGUAGE_NODES } from '../languageConfig.js';
import { findAll } from '../parser.js';
import { makeIssue, limit } from './ruleUtils.js';

export const THRESHOLDS = {
  cyclomatic: 10, // McCabe's recommended upper limit per function
  cyclomaticHigh: 20,
  functionLength: 50,
  nestingDepth: 4,
  parameters: 5,
  lineLength: 120,
};

function complexityRules(ctx) {
  const issues = [];
  for (const fn of ctx.metrics.functions) {
    if (fn.cyclomatic > THRESHOLDS.cyclomatic) {
      issues.push(makeIssue(ctx, fn.startLine, {
        ruleId: 'high-cyclomatic-complexity',
        title: `High cyclomatic complexity in "${fn.name}" (${fn.cyclomatic})`,
        type: 'Maintainability Issue',
        severity: fn.cyclomatic > THRESHOLDS.cyclomaticHigh ? 'HIGH' : 'MEDIUM',
        explanation: `"${fn.name}" has ${fn.cyclomatic} independent paths through it. McCabe recommends keeping this at ${THRESHOLDS.cyclomatic} or below.`,
        impact: 'Complex functions are harder to understand, test completely and change safely.',
        suggestion: 'Split the function into smaller helper functions and simplify nested conditions.',
      }));
    }
    if (fn.length > THRESHOLDS.functionLength) {
      issues.push(makeIssue(ctx, fn.startLine, {
        ruleId: 'long-function',
        title: `Long function "${fn.name}" (${fn.length} lines)`,
        type: 'Code Smell',
        severity: 'MEDIUM',
        explanation: `"${fn.name}" is ${fn.length} lines long (limit: ${THRESHOLDS.functionLength}). This is the "Long Method" code smell.`,
        impact: 'Long functions usually do several jobs at once, which makes them hard to read and reuse.',
        suggestion: 'Extract logical steps into well-named helper functions.',
      }));
    }
    if (fn.maxNesting >= THRESHOLDS.nestingDepth) {
      issues.push(makeIssue(ctx, fn.startLine, {
        ruleId: 'deep-nesting',
        title: `Deeply nested code in "${fn.name}" (depth ${fn.maxNesting})`,
        type: 'Readability Issue',
        severity: 'MEDIUM',
        explanation: `Control statements are nested ${fn.maxNesting} levels deep inside "${fn.name}".`,
        impact: 'Deep nesting makes the flow of control hard to follow and hides bugs.',
        suggestion: 'Use early returns (guard clauses) or move inner blocks into separate functions.',
      }));
    }
    if (fn.parameters > THRESHOLDS.parameters) {
      issues.push(makeIssue(ctx, fn.startLine, {
        ruleId: 'too-many-parameters',
        title: `Too many parameters in "${fn.name}" (${fn.parameters})`,
        type: 'Code Smell',
        severity: 'LOW',
        explanation: `"${fn.name}" takes ${fn.parameters} parameters. This is the "Long Parameter List" code smell.`,
        impact: 'Callers can easily pass arguments in the wrong order.',
        suggestion: 'Group related parameters into an object/structure.',
      }));
    }
  }
  return issues;
}

function longLineRule(ctx) {
  const longLines = [];
  ctx.lines.forEach((line, index) => {
    if (line.length > THRESHOLDS.lineLength) longLines.push(index + 1);
  });
  if (!longLines.length) return [];
  return [makeIssue(ctx, longLines[0], {
    ruleId: 'long-lines',
    title: `${longLines.length} line(s) longer than ${THRESHOLDS.lineLength} characters`,
    type: 'Readability Issue',
    severity: 'LOW',
    explanation: `Lines ${longLines.slice(0, 8).join(', ')}${longLines.length > 8 ? ', …' : ''} exceed ${THRESHOLDS.lineLength} characters.`,
    impact: 'Long lines require horizontal scrolling and are hard to review.',
    suggestion: 'Break long expressions over several lines or introduce intermediate variables.',
  })];
}

function todoCommentRule(ctx) {
  const lines = [];
  ctx.lines.forEach((line, index) => {
    if (/(#|\/\/|\/\*|\*).*\b(TODO|FIXME|HACK|XXX)\b/.test(line)) lines.push(index + 1);
  });
  if (!lines.length) return [];
  return [makeIssue(ctx, lines[0], {
    ruleId: 'todo-comment',
    title: `${lines.length} TODO/FIXME comment(s) left in the code`,
    type: 'Maintainability Issue',
    severity: 'INFO',
    explanation: `Unfinished-work markers were found on line(s) ${lines.join(', ')}.`,
    impact: 'They usually point to incomplete or temporary logic.',
    suggestion: 'Finish the work or track it in an issue tracker, then remove the comment.',
  })];
}

function hardcodedSecretRule(ctx) {
  const pattern = /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\w*\s*[:=]\s*["'][^"'\s]{4,}["']/i;
  const issues = [];
  ctx.lines.forEach((line, index) => {
    if (pattern.test(line)) {
      issues.push(makeIssue(ctx, index + 1, {
        ruleId: 'hardcoded-secret',
        title: 'Hard-coded secret or password',
        type: 'Security Issue',
        severity: 'HIGH',
        explanation: 'A password, key or token appears to be written directly in the source code.',
        impact: 'Anyone who can read the code (or its version history) can read and misuse the secret.',
        suggestion: 'Load secrets from environment variables or a secrets manager instead.',
        confidence: 'likely',
      }));
    }
  });
  return limit(issues, 3);
}

function mixedIndentationRule(ctx) {
  let tabs = 0;
  let spaces = 0;
  let firstMixedLine = null;
  ctx.lines.forEach((line, index) => {
    const indent = line.match(/^[ \t]*/)[0];
    if (!indent || line.trim() === '') return;
    if (indent.includes('\t')) tabs += 1;
    if (indent.includes(' ')) spaces += 1;
    if (indent.includes('\t') && indent.includes(' ') && firstMixedLine === null) firstMixedLine = index + 1;
  });
  if (!(tabs && spaces)) return [];
  const isPython = ctx.language === 'python';
  return [makeIssue(ctx, firstMixedLine ?? 1, {
    ruleId: 'mixed-indentation',
    title: 'Mixed tabs and spaces in indentation',
    type: 'Coding Standard Issue',
    severity: isPython ? 'HIGH' : 'LOW',
    explanation: `${tabs} line(s) are indented with tabs and ${spaces} with spaces.`,
    impact: isPython
      ? 'Python uses indentation for structure; mixing tabs and spaces can raise TabError or change meaning.'
      : 'Indentation will look different in different editors.',
    suggestion: 'Use spaces only (4 per level is the common convention).',
  })];
}

// Code after return/throw/break/continue in the same block never runs.
// (JavaScript is covered by ESLint's no-unreachable rule instead.)
function unreachableCodeRule(ctx) {
  if (ctx.language === 'javascript') return [];
  const nodes = LANGUAGE_NODES[ctx.language];
  const exits = new Set(nodes.exits);
  const commentTypes = new Set(nodes.comments);
  const issues = [];

  for (const block of findAll(ctx.root, nodes.blocks)) {
    const statements = block.namedChildren.filter((child) => !commentTypes.has(child.type));
    const exitIndex = statements.findIndex((statement) => exits.has(statement.type));
    if (exitIndex !== -1 && exitIndex < statements.length - 1) {
      const unreachable = statements[exitIndex + 1];
      issues.push(makeIssue(ctx, unreachable, {
        ruleId: 'unreachable-code',
        title: 'Unreachable code',
        type: 'Logical Error',
        severity: 'MEDIUM',
        explanation: `This statement comes after a "${statements[exitIndex].type.replace(/_statement$/, '')}" statement in the same block, so it can never execute.`,
        impact: 'The code will never run, which usually means the logic is not doing what was intended.',
        suggestion: 'Remove the dead code or move it before the return/break/throw.',
      }));
    }
  }
  return limit(issues, 5);
}

// `i <= arr.length` / `i <= v.size()` usually reads one element past the end.
function offByOneLoopRule(ctx) {
  if (ctx.language === 'python') return [];
  const issues = [];
  for (const loop of findAll(ctx.root, ['for_statement'])) {
    const condition = loop.childForFieldName('condition');
    if (condition && /<=\s*[\w.[\]]+\s*\.\s*(size\s*\(\s*\)|length\s*\(\s*\)|length\b)/.test(condition.text)) {
      issues.push(makeIssue(ctx, loop, {
        ruleId: 'off-by-one-loop',
        title: 'Possible off-by-one error in loop condition',
        type: 'Logical Error',
        severity: 'HIGH',
        explanation: `The condition "${condition.text}" uses <= with the collection size. Valid indexes go from 0 to size - 1, so the last iteration reads one element past the end.`,
        impact: 'Out-of-bounds access: an exception in Java/JavaScript (undefined value) or undefined behaviour in C++.',
        suggestion: 'Use < instead of <= when the loop variable is used as an index.',
        confidence: 'likely',
      }));
    }
  }
  return limit(issues, 3);
}

const DIVISION_NODES = { python: 'binary_operator', java: 'binary_expression', cpp: 'binary_expression', javascript: 'binary_expression' };

function divisionByZeroRule(ctx) {
  const issues = [];
  for (const node of findAll(ctx.root, [DIVISION_NODES[ctx.language]])) {
    const operator = node.children.find((child) => !child.isNamed)?.type;
    const right = node.childForFieldName('right');
    if (['/', '//', '%'].includes(operator) && right && /^0+(\.0*)?[fFlL]?$/.test(right.text)) {
      issues.push(makeIssue(ctx, node, {
        ruleId: 'division-by-zero',
        title: 'Division by zero',
        type: 'Runtime Risk',
        severity: 'HIGH',
        explanation: `The expression "${node.text}" divides by the constant zero.`,
        impact: 'This raises an exception (Python/Java) or causes undefined behaviour / Infinity (C++/JavaScript).',
        suggestion: 'Check the divisor before dividing, or fix the constant.',
      }));
    }
  }
  return limit(issues, 3);
}

export function runCommonRules(ctx) {
  return [
    ...complexityRules(ctx),
    ...unreachableCodeRule(ctx),
    ...offByOneLoopRule(ctx),
    ...divisionByZeroRule(ctx),
    ...hardcodedSecretRule(ctx),
    ...mixedIndentationRule(ctx),
    ...longLineRule(ctx),
    ...todoCommentRule(ctx),
  ];
}
