// Python-specific checks performed on the syntax tree (AST-based checks).
import { findAll, hasAncestor } from '../parser.js';
import { operatorOf } from '../astUtils.js';
import { makeIssue, limit, countIdentifierUses } from './ruleUtils.js';

const BUILTINS = new Set([
  'list', 'dict', 'str', 'int', 'float', 'set', 'tuple', 'sum', 'max', 'min', 'len', 'id', 'input',
  'type', 'map', 'filter', 'range', 'open', 'print', 'iter', 'next', 'all', 'any', 'sorted', 'format', 'object',
]);

function exceptRules(ctx) {
  const issues = [];
  for (const clause of findAll(ctx.root, ['except_clause'])) {
    const block = clause.namedChildren.find((child) => child.type === 'block');
    const hasType = clause.namedChildren.some((child) => child.type !== 'block' && child.type !== 'comment');

    if (!hasType) {
      issues.push(makeIssue(ctx, clause, {
        ruleId: 'python-bare-except',
        title: 'Bare "except:" catches every exception',
        type: 'Runtime Risk',
        severity: 'MEDIUM',
        explanation: 'A bare except also catches KeyboardInterrupt, SystemExit and programming errors such as NameError.',
        impact: 'Real bugs are hidden and the program may be impossible to stop with Ctrl+C.',
        suggestion: 'Catch the specific exception you expect, e.g. "except ValueError:".',
      }));
    }
    const statements = block ? block.namedChildren.filter((child) => child.type !== 'comment') : [];
    if (statements.length === 1 && statements[0].type === 'pass_statement') {
      issues.push(makeIssue(ctx, statements[0], {
        ruleId: 'python-except-pass',
        title: 'Exception silently ignored',
        type: 'Code Smell',
        severity: 'MEDIUM',
        explanation: 'The except block only contains "pass", so the error is swallowed without any message.',
        impact: 'Failures go unnoticed and the program continues with wrong or missing data.',
        suggestion: 'Log the error, show a message, or re-raise it.',
      }));
    }
  }
  return issues;
}

function mutableDefaultRule(ctx) {
  const issues = [];
  for (const param of findAll(ctx.root, ['default_parameter', 'typed_default_parameter'])) {
    const value = param.childForFieldName('value');
    if (value && ['list', 'dictionary', 'set'].includes(value.type)) {
      const name = param.childForFieldName('name')?.text ?? 'parameter';
      issues.push(makeIssue(ctx, param, {
        ruleId: 'python-mutable-default',
        title: `Mutable default argument "${name}"`,
        type: 'Logical Error',
        severity: 'HIGH',
        explanation: `The default value ${value.text} is created once, when the function is defined, and then shared by every call.`,
        impact: 'Changes made in one call leak into later calls, producing surprising results.',
        suggestion: `Use "${name}=None" and create a new ${value.type === 'dictionary' ? 'dict' : value.type} inside the function.`,
      }));
    }
  }
  return issues;
}

function comparisonRules(ctx) {
  const issues = [];
  for (const node of findAll(ctx.root, ['comparison_operator'])) {
    const operator = operatorOf(node);
    const operands = node.namedChildren;

    if ((operator === '==' || operator === '!=') && operands.some((child) => child.type === 'none')) {
      issues.push(makeIssue(ctx, node, {
        ruleId: 'python-none-comparison',
        title: 'Comparison to None with == / !=',
        type: 'Coding Standard Issue',
        severity: 'LOW',
        explanation: `"${node.text}" compares with None using ${operator}. PEP 8 recommends "is None" / "is not None".`,
        impact: 'Objects can override ==, so the result may be wrong for some types.',
        suggestion: operator === '==' ? 'Use "is None".' : 'Use "is not None".',
      }));
    } else if ((operator === '==' || operator === '!=') && operands.some((child) => child.type === 'true' || child.type === 'false')) {
      issues.push(makeIssue(ctx, node, {
        ruleId: 'python-bool-comparison',
        title: 'Comparison to True/False',
        type: 'Coding Standard Issue',
        severity: 'LOW',
        explanation: `"${node.text}" compares directly with a boolean literal.`,
        impact: 'It is redundant and less readable.',
        suggestion: 'Use the value directly: "if flag:" or "if not flag:".',
      }));
    } else if (operator === 'is' && operands.some((child) => ['integer', 'float', 'string'].includes(child.type))) {
      issues.push(makeIssue(ctx, node, {
        ruleId: 'python-is-literal',
        title: '"is" used to compare with a literal',
        type: 'Logical Error',
        severity: 'MEDIUM',
        explanation: `"${node.text}" checks object identity, not equality. It only works by accident for some small values.`,
        impact: 'The comparison can be False even when the values are equal.',
        suggestion: 'Use == to compare values.',
      }));
    }
  }
  return limit(issues, 6);
}

function dangerousCallRules(ctx) {
  const issues = [];
  for (const call of findAll(ctx.root, ['call'])) {
    const fn = call.childForFieldName('function');
    if (fn?.type === 'identifier' && (fn.text === 'eval' || fn.text === 'exec')) {
      issues.push(makeIssue(ctx, call, {
        ruleId: 'python-eval',
        title: `Use of ${fn.text}()`,
        type: 'Security Issue',
        severity: 'HIGH',
        explanation: `${fn.text}() runs any Python code contained in a string.`,
        impact: 'If the string comes from user input, an attacker can execute arbitrary code.',
        suggestion: 'Use ast.literal_eval() for literals, or parse the input explicitly.',
      }));
    }
    // for i in range(len(items)):
    if (fn?.text === 'range' && call.parent?.type === 'for_statement') {
      const args = call.childForFieldName('arguments')?.namedChildren ?? [];
      if (args.length === 1 && args[0].type === 'call' && args[0].childForFieldName('function')?.text === 'len') {
        issues.push(makeIssue(ctx, call, {
          ruleId: 'python-range-len',
          title: 'Loop uses range(len(...))',
          type: 'Readability Issue',
          severity: 'LOW',
          explanation: 'Looping over indexes is less readable than looping over the items directly.',
          impact: 'Index-based loops are easier to get wrong (off-by-one errors).',
          suggestion: 'Use "for item in items:" or "for i, item in enumerate(items):".',
        }));
      }
    }
  }
  return issues;
}

function importRules(ctx) {
  const issues = [];
  const importNodes = new Set();

  for (const statement of findAll(ctx.root, ['import_statement', 'import_from_statement'])) {
    importNodes.add(statement.id);
    if (statement.namedChildren.some((child) => child.type === 'wildcard_import')) {
      issues.push(makeIssue(ctx, statement, {
        ruleId: 'python-wildcard-import',
        title: 'Wildcard import',
        type: 'Maintainability Issue',
        severity: 'LOW',
        explanation: `"${statement.text}" imports every public name from the module.`,
        impact: 'It is unclear where names come from, and names can silently shadow each other.',
        suggestion: 'Import only the names you need.',
      }));
    }
  }

  // Unused imports: the imported name never appears outside import statements.
  const usedNames = new Set();
  const stack = [ctx.root];
  while (stack.length) {
    const node = stack.pop();
    if (importNodes.has(node.id)) continue;
    if (node.type === 'identifier') usedNames.add(node.text);
    for (let i = 0; i < node.childCount; i += 1) stack.push(node.child(i));
  }

  for (const statement of findAll(ctx.root, ['import_statement', 'import_from_statement'])) {
    if (statement.childForFieldName('module_name')?.text === '__future__') continue;
    for (const nameNode of statement.childrenForFieldName('name')) {
      const bound = nameNode.type === 'aliased_import'
        ? nameNode.childForFieldName('alias')?.text
        : nameNode.text.split('.')[0];
      if (bound && !usedNames.has(bound)) {
        issues.push(makeIssue(ctx, statement, {
          ruleId: 'python-unused-import',
          title: `Unused import "${bound}"`,
          type: 'Maintainability Issue',
          severity: 'LOW',
          explanation: `"${bound}" is imported but never used.`,
          impact: 'Unused imports slow start-up slightly and make dependencies unclear.',
          suggestion: `Remove the import of "${bound}".`,
        }));
      }
    }
  }
  return issues;
}

function variableRules(ctx) {
  const issues = [];
  for (const fn of findAll(ctx.root, ['function_definition'])) {
    const body = fn.childForFieldName('body');
    if (!body) continue;
    const declaredGlobal = new Set(
      findAll(body, ['global_statement', 'nonlocal_statement']).flatMap((s) => s.namedChildren.map((n) => n.text)),
    );
    const reported = new Set();

    for (const assignment of findAll(body, ['assignment'])) {
      if (hasAncestor(assignment, ['function_definition'], fn)) continue; // belongs to a nested function
      const target = assignment.childForFieldName('left');
      if (target?.type !== 'identifier') continue;
      const name = target.text;
      if (name.startsWith('_') || declaredGlobal.has(name) || reported.has(name)) continue;

      if (countIdentifierUses(body, name, target) === 0) {
        reported.add(name);
        issues.push(makeIssue(ctx, assignment, {
          ruleId: 'python-unused-variable',
          title: `Unused variable "${name}"`,
          type: 'Maintainability Issue',
          severity: 'LOW',
          explanation: `"${name}" is assigned a value but never read inside "${fn.childForFieldName('name')?.text}".`,
          impact: 'It adds noise and may indicate unfinished or incorrect logic.',
          suggestion: `Remove "${name}" if it is not needed, or use it where intended.`,
        }));
      }
    }
  }

  // Shadowing built-in names such as list, sum or max.
  const shadowed = new Set();
  for (const assignment of findAll(ctx.root, ['assignment', 'for_statement', 'parameters'])) {
    const targets = assignment.type === 'parameters'
      ? assignment.namedChildren
        .map((param) => (param.type === 'identifier' ? param : param.childForFieldName('name')))
        .filter((target) => target?.type === 'identifier')
      : [assignment.childForFieldName('left')].filter((target) => target?.type === 'identifier');
    for (const target of targets) {
      if (BUILTINS.has(target.text) && !shadowed.has(target.text)) {
        shadowed.add(target.text);
        issues.push(makeIssue(ctx, target, {
          ruleId: 'python-shadow-builtin',
          title: `Built-in name "${target.text}" is shadowed`,
          type: 'Code Smell',
          severity: 'LOW',
          explanation: `Using "${target.text}" as a variable name hides Python's built-in ${target.text}().`,
          impact: `Later calls to ${target.text}() in the same scope will fail or behave unexpectedly.`,
          suggestion: `Rename the variable, e.g. "${target.text}_values" or a more descriptive name.`,
        }));
      }
    }
  }
  return issues;
}

export function runPythonRules(ctx) {
  return [
    ...exceptRules(ctx),
    ...mutableDefaultRule(ctx),
    ...comparisonRules(ctx),
    ...dangerousCallRules(ctx),
    ...importRules(ctx),
    ...limit(variableRules(ctx), 8),
  ];
}
