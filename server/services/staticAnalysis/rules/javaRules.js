// Java-specific checks performed on the syntax tree.
import { findAll, hasAncestor } from '../parser.js';
import { operatorOf } from '../astUtils.js';
import { makeIssue, limit, countIdentifierUses } from './ruleUtils.js';

const LOOP_TYPES = ['for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement'];
const CLOSEABLE_TYPES = new Set([
  'Scanner', 'FileReader', 'FileWriter', 'FileInputStream', 'FileOutputStream',
  'BufferedReader', 'BufferedWriter', 'PrintWriter', 'InputStreamReader',
]);

// Names of variables, parameters and fields declared with type String.
function collectStringVariables(root) {
  const names = new Set();
  for (const decl of findAll(root, ['local_variable_declaration', 'field_declaration', 'formal_parameter'])) {
    if (decl.childForFieldName('type')?.text !== 'String') continue;
    if (decl.type === 'formal_parameter') {
      names.add(decl.childForFieldName('name')?.text);
    } else {
      for (const declarator of decl.childrenForFieldName('declarator')) {
        names.add(declarator.childForFieldName('name')?.text);
      }
    }
  }
  return names;
}

function stringComparisonRule(ctx, stringVars) {
  const issues = [];
  for (const node of findAll(ctx.root, ['binary_expression'])) {
    const operator = operatorOf(node);
    if (operator !== '==' && operator !== '!=') continue;
    const operands = [node.childForFieldName('left'), node.childForFieldName('right')];
    const involvesString = operands.some(
      (operand) => operand?.type === 'string_literal' || (operand?.type === 'identifier' && stringVars.has(operand.text)),
    );
    const comparesNull = operands.some((operand) => operand?.type === 'null_literal');
    if (involvesString && !comparesNull) {
      issues.push(makeIssue(ctx, node, {
        ruleId: 'java-string-equality',
        title: `Strings compared with ${operator}`,
        type: 'Logical Error',
        severity: 'HIGH',
        explanation: `"${node.text}" compares object references, not the text inside the strings.`,
        impact: 'Two strings with the same characters can still be "not equal", so the condition gives wrong results.',
        suggestion: operator === '==' ? 'Use a.equals(b) (or Objects.equals(a, b) if a can be null).' : 'Use !a.equals(b).',
      }));
    }
  }
  return limit(issues, 5);
}

function exceptionRules(ctx) {
  const issues = [];
  for (const clause of findAll(ctx.root, ['catch_clause'])) {
    const body = clause.childForFieldName('body');
    const statements = body ? body.namedChildren.filter((child) => !child.type.endsWith('comment')) : [];
    if (statements.length === 0) {
      issues.push(makeIssue(ctx, clause, {
        ruleId: 'java-empty-catch',
        title: 'Empty catch block',
        type: 'Code Smell',
        severity: 'MEDIUM',
        explanation: 'The exception is caught and then ignored completely.',
        impact: 'Errors disappear silently, which makes bugs very hard to find.',
        suggestion: 'Log the exception, show a message to the user, or rethrow it.',
      }));
    }
    const caughtType = clause.namedChildren
      .find((child) => child.type === 'catch_formal_parameter')
      ?.namedChildren.find((child) => child.type === 'catch_type')?.text;
    if (caughtType === 'Exception' || caughtType === 'Throwable') {
      issues.push(makeIssue(ctx, clause, {
        ruleId: 'java-generic-catch',
        title: `Catching generic ${caughtType}`,
        type: 'Coding Standard Issue',
        severity: 'LOW',
        explanation: `catch (${caughtType} e) also catches programming errors such as NullPointerException.`,
        impact: 'Unexpected bugs are handled as if they were expected situations.',
        suggestion: 'Catch the specific exception types the code can actually throw.',
      }));
    }
  }
  return issues;
}

function classDesignRules(ctx) {
  const issues = [];
  for (const field of findAll(ctx.root, ['field_declaration'])) {
    const modifiers = field.namedChildren.find((child) => child.type === 'modifiers')?.text ?? '';
    const isConstant = /\bstatic\b/.test(modifiers) && /\bfinal\b/.test(modifiers);
    const names = field.childrenForFieldName('declarator').map((d) => d.childForFieldName('name')?.text);

    if (/\bpublic\b/.test(modifiers) && !isConstant) {
      issues.push(makeIssue(ctx, field, {
        ruleId: 'java-public-field',
        title: `Public field "${names.join(', ')}"`,
        type: 'Code Smell',
        severity: 'LOW',
        explanation: 'The field can be changed directly by any other class.',
        impact: 'Breaks encapsulation: the class cannot protect its own data or validate changes.',
        suggestion: 'Make the field private and add getter/setter methods if access is needed.',
      }));
    }
    if (isConstant) {
      for (const name of names) {
        if (name && !/^[A-Z][A-Z0-9_]*$/.test(name)) {
          issues.push(makeIssue(ctx, field, {
            ruleId: 'java-constant-naming',
            title: `Constant "${name}" is not UPPER_SNAKE_CASE`,
            type: 'Coding Standard Issue',
            severity: 'LOW',
            explanation: 'Java convention names static final constants in UPPER_SNAKE_CASE.',
            impact: 'Readers cannot tell at a glance that the value is a constant.',
            suggestion: `Rename to "${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}".`,
          }));
        }
      }
    }
  }

  for (const cls of findAll(ctx.root, ['class_declaration', 'interface_declaration'])) {
    const name = cls.childForFieldName('name')?.text;
    if (name && !/^[A-Z][A-Za-z0-9]*$/.test(name)) {
      issues.push(makeIssue(ctx, cls, {
        ruleId: 'java-class-naming',
        title: `Class "${name}" is not PascalCase`,
        type: 'Coding Standard Issue',
        severity: 'LOW',
        explanation: 'Java convention names classes in PascalCase (e.g. StudentRecord).',
        impact: 'Inconsistent naming makes code harder to read.',
        suggestion: 'Rename the class using PascalCase.',
      }));
    }
  }
  for (const method of findAll(ctx.root, ['method_declaration'])) {
    const name = method.childForFieldName('name')?.text;
    if (name && !/^[a-z][A-Za-z0-9]*$/.test(name)) {
      issues.push(makeIssue(ctx, method, {
        ruleId: 'java-method-naming',
        title: `Method "${name}" is not camelCase`,
        type: 'Coding Standard Issue',
        severity: 'LOW',
        explanation: 'Java convention names methods in camelCase (e.g. calculateTotal).',
        impact: 'Inconsistent naming makes code harder to read.',
        suggestion: 'Rename the method using camelCase.',
      }));
    }
  }
  return limit(issues, 8);
}

function unusedRules(ctx) {
  const issues = [];
  for (const method of findAll(ctx.root, ['method_declaration', 'constructor_declaration'])) {
    const body = method.childForFieldName('body');
    if (!body) continue;
    for (const decl of findAll(body, ['local_variable_declaration'])) {
      for (const declarator of decl.childrenForFieldName('declarator')) {
        const nameNode = declarator.childForFieldName('name');
        if (nameNode && countIdentifierUses(body, nameNode.text, nameNode) === 0) {
          issues.push(makeIssue(ctx, decl, {
            ruleId: 'java-unused-variable',
            title: `Unused local variable "${nameNode.text}"`,
            type: 'Maintainability Issue',
            severity: 'LOW',
            explanation: `"${nameNode.text}" is declared but never used.`,
            impact: 'It adds noise and may indicate unfinished logic.',
            suggestion: `Remove "${nameNode.text}" or use it where intended.`,
          }));
        }
      }
    }
  }

  for (const imp of findAll(ctx.root, ['import_declaration'])) {
    if (imp.namedChildren.some((child) => child.type === 'asterisk')) continue;
    const simpleName = imp.text.replace(/^import\s+(static\s+)?/, '').replace(/;$/, '').split('.').pop().trim();
    const uses = countIdentifierUses(ctx.root, simpleName, null, ['identifier', 'type_identifier'])
      - countIdentifierUses(imp, simpleName, null, ['identifier', 'type_identifier']);
    if (uses === 0) {
      issues.push(makeIssue(ctx, imp, {
        ruleId: 'java-unused-import',
        title: `Unused import "${simpleName}"`,
        type: 'Maintainability Issue',
        severity: 'LOW',
        explanation: `${imp.text} is never used in this file.`,
        impact: 'Unused imports clutter the file and hide real dependencies.',
        suggestion: 'Remove the unused import.',
      }));
    }
  }
  return limit(issues, 8);
}

function performanceAndResourceRules(ctx, stringVars) {
  const issues = [];

  // String concatenation with += inside a loop creates a new String every time.
  for (const assignment of findAll(ctx.root, ['assignment_expression'])) {
    const left = assignment.childForFieldName('left');
    if (operatorOf(assignment) === '+=' && left?.type === 'identifier' && stringVars.has(left.text)
      && hasAncestor(assignment, LOOP_TYPES)) {
      issues.push(makeIssue(ctx, assignment, {
        ruleId: 'java-string-concat-loop',
        title: 'String concatenation inside a loop',
        type: 'Performance Issue',
        severity: 'MEDIUM',
        explanation: `"${assignment.text}" creates a brand-new String object on every iteration because Strings are immutable.`,
        impact: 'Time grows roughly with the square of the number of iterations (O(n²) copying).',
        suggestion: 'Use a StringBuilder and call append() inside the loop.',
      }));
      break;
    }
  }

  // Readers/Scanners/streams that are never closed.
  const code = ctx.lines.join('\n');
  for (const creation of findAll(ctx.root, ['object_creation_expression'])) {
    const typeName = creation.childForFieldName('type')?.text;
    if (!CLOSEABLE_TYPES.has(typeName) || hasAncestor(creation, ['resource_specification'])) continue;
    const variable = creation.parent?.type === 'variable_declarator' ? creation.parent.childForFieldName('name')?.text : null;
    if (variable && new RegExp(`\\b${variable}\\s*\\.\\s*close\\s*\\(`).test(code)) continue;
    issues.push(makeIssue(ctx, creation, {
      ruleId: 'java-resource-leak',
      title: `${typeName} is never closed`,
      type: 'Runtime Risk',
      severity: typeName === 'Scanner' && /System\.in/.test(creation.text) ? 'LOW' : 'MEDIUM',
      explanation: `A ${typeName} holds an operating-system resource, but it is not closed and not inside try-with-resources.`,
      impact: 'Leaked file handles or streams can exhaust system resources in long-running programs.',
      suggestion: `Use try-with-resources: try (${typeName} x = new ${typeName}(...)) { ... }`,
    }));
  }
  return limit(issues, 5);
}

function braceRule(ctx) {
  const issues = [];
  for (const statement of findAll(ctx.root, ['if_statement', ...LOOP_TYPES])) {
    const body = statement.childForFieldName(statement.type === 'if_statement' ? 'consequence' : 'body');
    if (body && body.type !== 'block' && body.type !== 'if_statement') {
      issues.push(makeIssue(ctx, statement, {
        ruleId: 'java-missing-braces',
        title: 'Control statement without braces',
        type: 'Readability Issue',
        severity: 'LOW',
        explanation: 'Only the first statement after this if/loop belongs to it, which is easy to misread.',
        impact: 'Adding a second line later can silently change the program logic.',
        suggestion: 'Always use { } around the body of if statements and loops.',
      }));
    }
  }
  return limit(issues, 3);
}

export function runJavaRules(ctx) {
  const stringVars = collectStringVariables(ctx.root);
  return [
    ...stringComparisonRule(ctx, stringVars),
    ...exceptionRules(ctx),
    ...performanceAndResourceRules(ctx, stringVars),
    ...unusedRules(ctx),
    ...classDesignRules(ctx),
    ...braceRule(ctx),
  ];
}
