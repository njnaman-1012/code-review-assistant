// JavaScript is checked with ESLint, the industry-standard JavaScript linter.
// ESLint's Linter class works entirely in memory: it parses the code and
// applies rules, but never executes it.
import { Linter } from 'eslint';
import globals from 'globals';

const linter = new Linter();

// ESLint rule id -> how we classify and explain it.
const RULES = {
  'no-undef': { type: 'Runtime Risk', severity: 'HIGH', title: 'Undefined variable', impact: 'Using an undeclared name throws a ReferenceError at runtime (or silently creates a global).', suggestion: 'Declare the variable with let/const, or fix the spelling.' },
  'no-unused-vars': { type: 'Maintainability Issue', severity: 'LOW', title: 'Unused variable', impact: 'Dead code adds noise and may indicate unfinished logic.', suggestion: 'Remove the variable or use it where intended.' },
  eqeqeq: { type: 'Logical Error', severity: 'MEDIUM', title: 'Loose equality (== / !=)', impact: '== converts types before comparing, so 0 == "" and null == undefined are true.', suggestion: 'Use === and !== to compare without type conversion.' },
  'no-var': { type: 'Coding Standard Issue', severity: 'LOW', title: '"var" used instead of let/const', impact: 'var is function-scoped and hoisted, which causes confusing bugs in loops and blocks.', suggestion: 'Use const by default and let when the value must change.' },
  'prefer-const': { type: 'Coding Standard Issue', severity: 'LOW', title: 'Variable never reassigned should be const', impact: 'const documents intent and prevents accidental reassignment.', suggestion: 'Declare the variable with const.' },
  'no-eval': { type: 'Security Issue', severity: 'HIGH', title: 'Use of eval()', impact: 'eval executes any string as code - a serious injection risk if input reaches it.', suggestion: 'Use JSON.parse for data, or explicit logic instead of eval.' },
  'no-implied-eval': { type: 'Security Issue', severity: 'HIGH', title: 'Implied eval (string passed to setTimeout/setInterval)', impact: 'The string is evaluated as code, like eval().', suggestion: 'Pass a function instead of a string.' },
  'no-new-func': { type: 'Security Issue', severity: 'HIGH', title: 'Function constructor used', impact: 'new Function(string) evaluates code like eval().', suggestion: 'Define a normal function instead.' },
  'no-empty': { type: 'Code Smell', severity: 'MEDIUM', title: 'Empty block', impact: 'An empty catch/if block usually hides an error or unfinished logic.', suggestion: 'Handle the case, log the error, or add a comment explaining why it is empty.' },
  'no-unreachable': { type: 'Logical Error', severity: 'MEDIUM', title: 'Unreachable code', impact: 'Code after return/throw/break never runs.', suggestion: 'Remove the dead code or move it before the return/throw.' },
  'no-dupe-keys': { type: 'Logical Error', severity: 'HIGH', title: 'Duplicate key in object literal', impact: 'The later value silently overwrites the earlier one.', suggestion: 'Remove or rename the duplicate key.' },
  'no-duplicate-case': { type: 'Logical Error', severity: 'HIGH', title: 'Duplicate case label', impact: 'The second case can never be reached.', suggestion: 'Remove or correct the duplicate case.' },
  'no-dupe-args': { type: 'Logical Error', severity: 'HIGH', title: 'Duplicate parameter name', impact: 'Only the last parameter with that name is usable.', suggestion: 'Give each parameter a unique name.' },
  'no-constant-condition': { type: 'Logical Error', severity: 'MEDIUM', title: 'Constant condition', impact: 'The condition is always true or always false, so one branch is dead or the loop never ends.', suggestion: 'Use a real condition (or an explicit loop exit).' },
  'no-self-compare': { type: 'Logical Error', severity: 'MEDIUM', title: 'Value compared with itself', impact: 'x === x is always true (except NaN) - usually a typo.', suggestion: 'Compare with the intended variable; use Number.isNaN() for NaN checks.' },
  'no-self-assign': { type: 'Logical Error', severity: 'MEDIUM', title: 'Variable assigned to itself', impact: 'The assignment has no effect - usually a typo.', suggestion: 'Assign the intended value.' },
  'no-cond-assign': { type: 'Logical Error', severity: 'HIGH', title: 'Assignment inside a condition', impact: 'if (x = 5) assigns instead of comparing, so the condition is almost always true.', suggestion: 'Use === to compare.' },
  'use-isnan': { type: 'Logical Error', severity: 'HIGH', title: 'Comparison with NaN', impact: 'NaN is never equal to anything, including itself.', suggestion: 'Use Number.isNaN(value).' },
  'valid-typeof': { type: 'Logical Error', severity: 'HIGH', title: 'Invalid typeof comparison', impact: 'typeof never returns this string, so the comparison is always false.', suggestion: 'Compare with a valid type name such as "string" or "number".' },
  'no-redeclare': { type: 'Logical Error', severity: 'MEDIUM', title: 'Variable declared twice', impact: 'The second declaration silently replaces the first.', suggestion: 'Remove the duplicate declaration.' },
  'no-fallthrough': { type: 'Logical Error', severity: 'MEDIUM', title: 'Switch case falls through', impact: 'Execution continues into the next case, which is often unintended.', suggestion: 'Add break (or a comment if the fall-through is intentional).' },
  'no-unsafe-finally': { type: 'Logical Error', severity: 'MEDIUM', title: 'Control flow in finally block', impact: 'return/throw in finally overrides the result of try/catch.', suggestion: 'Do not return or throw from a finally block.' },
  'no-unsafe-negation': { type: 'Logical Error', severity: 'HIGH', title: 'Unsafe negation', impact: '!key in obj negates key, not the whole expression.', suggestion: 'Use parentheses: !(key in obj).' },
  'no-useless-catch': { type: 'Code Smell', severity: 'LOW', title: 'Catch block only rethrows', impact: 'The try/catch adds nothing.', suggestion: 'Remove the try/catch wrapper.' },
  'no-loop-func': { type: 'Runtime Risk', severity: 'MEDIUM', title: 'Function created inside a loop', impact: 'Closures may capture the loop variable incorrectly.', suggestion: 'Move the function outside the loop or use let for the loop variable.' },
  'no-unmodified-loop-condition': { type: 'Logical Error', severity: 'HIGH', title: 'Loop condition never changes', impact: 'The loop may never terminate (infinite loop).', suggestion: 'Update the variables used in the condition inside the loop.' },
  'array-callback-return': { type: 'Logical Error', severity: 'MEDIUM', title: 'Array callback does not return a value', impact: 'map/filter/reduce will produce undefined values.', suggestion: 'Return a value from the callback.' },
  'no-global-assign': { type: 'Runtime Risk', severity: 'HIGH', title: 'Built-in global reassigned', impact: 'Overwriting globals like undefined or Object breaks other code.', suggestion: 'Use a different variable name.' },
  'no-await-in-loop': { type: 'Performance Issue', severity: 'LOW', title: 'await inside a loop', impact: 'Iterations run one after another instead of in parallel.', suggestion: 'Collect the promises and use await Promise.all(...) when the iterations are independent.' },
  'no-debugger': { type: 'Coding Standard Issue', severity: 'LOW', title: 'debugger statement left in code', impact: 'It pauses execution when developer tools are open.', suggestion: 'Remove the debugger statement.' },
};

const NAMED_RULES = new Set(['no-undef', 'no-unused-vars', 'prefer-const', 'no-redeclare', 'no-global-assign']);

const ruleConfig = Object.fromEntries(Object.keys(RULES).map((ruleId) => [ruleId, 'warn']));
ruleConfig.eqeqeq = ['warn', 'always', { null: 'ignore' }];
ruleConfig['no-unused-vars'] = ['warn', { args: 'after-used', caughtErrors: 'none' }];

function looksLikeModule(code) {
  return /^\s*(import\s[\s\S]*?from\s|import\s*['"]|export\s)/m.test(code);
}

export function runJavaScriptRules(ctx) {
  const messages = linter.verify(
    ctx.code,
    [{
      files: ['**/*.js', '**/*.jsx'],
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: looksLikeModule(ctx.code) ? 'module' : 'script',
        globals: { ...globals.browser, ...globals.node },
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      rules: ruleConfig,
    }],
    { filename: 'submitted-code.jsx' },
  );

  const issues = [];
  for (const message of messages) {
    const line = message.line ?? 1;
    const code = (ctx.lines[line - 1] ?? '').trim();

    if (message.fatal) {
      issues.push({
        ruleId: 'syntax-error',
        title: 'Invalid syntax',
        type: 'Syntax Error',
        severity: 'CRITICAL',
        line,
        code,
        explanation: `The JavaScript parser could not understand the code: ${message.message.replace(/^Parsing error:\s*/, '')}.`,
        impact: 'The program will not run until the syntax error is fixed.',
        suggestion: 'Check the brackets, parentheses, quotes and punctuation on this line and the line above it.',
        source: 'static',
        confidence: 'confirmed',
      });
      continue;
    }

    const rule = RULES[message.ruleId];
    if (!rule) continue;
    // ESLint messages quote the variable name, e.g. "'total' is not defined."
    const name = message.message.match(/'([^']+)'/)?.[1];
    issues.push({
      ruleId: `js-${message.ruleId}`,
      title: name && NAMED_RULES.has(message.ruleId) ? `${rule.title} "${name}"` : rule.title,
      type: rule.type,
      severity: rule.severity,
      line,
      code,
      explanation: message.message,
      impact: rule.impact,
      suggestion: rule.suggestion,
      source: 'static',
      confidence: 'confirmed',
    });
  }
  return issues;
}
