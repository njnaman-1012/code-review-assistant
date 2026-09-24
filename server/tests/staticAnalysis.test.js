import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCode } from '../services/staticAnalysis/index.js';

const ruleIds = (result) => result.issues.map((issue) => issue.ruleId);

describe('Syntax checking', () => {
  test('detects Python syntax errors with a line number', async () => {
    const result = await analyzeCode('def f(x):\n    if x > 1\n        return x\n', 'python');
    assert.equal(result.syntaxValid, false);
    assert.equal(result.issues[0].type, 'Syntax Error');
    assert.equal(result.issues[0].severity, 'CRITICAL');
    assert.equal(result.issues[0].line, 2);
  });

  test('detects a missing semicolon in Java', async () => {
    const result = await analyzeCode('class A { void m() { int x = 1 } }', 'java');
    assert.equal(result.syntaxValid, false);
    assert.ok(result.issues.some((issue) => issue.ruleId === 'syntax-missing-token'));
  });

  test('detects JavaScript syntax errors through ESLint', async () => {
    const result = await analyzeCode('function f( {\n  return 1;\n}', 'javascript');
    assert.equal(result.syntaxValid, false);
    assert.match(result.issues[0].explanation, /JavaScript parser could not understand/);
  });

  test('accepts valid code in all four languages', async () => {
    const samples = {
      python: 'def add(a, b):\n    return a + b\n\nprint(add(1, 2))\n',
      java: 'public class Main { public static void main(String[] args) { System.out.println(1); } }',
      cpp: '#include <iostream>\nint main() { std::cout << 1 << "\\n"; return 0; }',
      javascript: 'const add = (a, b) => a + b;\nconsole.log(add(1, 2));\n',
    };
    for (const [language, code] of Object.entries(samples)) {
      const result = await analyzeCode(code, language);
      assert.equal(result.syntaxValid, true, `${language} should be valid`);
    }
  });
});

describe('Language rules', () => {
  test('Python: mutable default, bare except, None comparison, eval, unused import', async () => {
    const code = [
      'import os',
      'def f(items=[]):',
      '    if items == None:',
      '        return eval("1")',
      '    try:',
      '        pass',
      '    except:',
      '        pass',
    ].join('\n');
    const ids = ruleIds(await analyzeCode(code, 'python'));
    for (const id of ['python-mutable-default', 'python-bare-except', 'python-except-pass', 'python-none-comparison', 'python-eval', 'python-unused-import']) {
      assert.ok(ids.includes(id), `expected ${id}`);
    }
  });

  test('Java: string ==, empty catch, off-by-one, string concatenation in loop', async () => {
    const code = `public class A {
  String s(String a) {
    String out = "";
    if (a == "x") { return a; }
    try { a.trim(); } catch (Exception e) { }
    for (int i = 0; i <= a.length(); i++) { out += a; }
    return out;
  }
}`;
    const ids = ruleIds(await analyzeCode(code, 'java'));
    for (const id of ['java-string-equality', 'java-empty-catch', 'off-by-one-loop', 'java-string-concat-loop']) {
      assert.ok(ids.includes(id), `expected ${id}`);
    }
  });

  test('C++: gets, pass-by-value, new without delete, using namespace std', async () => {
    const code = '#include <vector>\nusing namespace std;\nint f(vector<int> v) { char b[8]; gets(b); int* p = new int[3]; return v.size(); }';
    const ids = ruleIds(await analyzeCode(code, 'cpp'));
    for (const id of ['cpp-unsafe-gets', 'cpp-pass-by-value', 'cpp-new-without-delete', 'cpp-using-namespace-std']) {
      assert.ok(ids.includes(id), `expected ${id}`);
    }
  });

  test('off-by-one loops are found for .size(), .length() and .length', async () => {
    const cpp = await analyzeCode('int f(std::vector<int>& v) { int s = 0; for (int i = 0; i <= v.size(); i++) { s += v[i]; } return s; }', 'cpp');
    const java = await analyzeCode([
      'class A {',
      '  int f(int[] a, String t) {',
      '    int s = 0;',
      '    for (int i = 0; i <= a.length; i++) { s++; }',
      '    for (int j = 0; j <= t.length(); j++) { s++; }',
      '    return s;',
      '  }',
      '}',
    ].join('\n'), 'java');
    const js = await analyzeCode('const a = [1];\nfor (let i = 0; i < a.length; i++) { console.log(a[i]); }\n', 'javascript');
    assert.equal(ruleIds(cpp).filter((id) => id === 'off-by-one-loop').length, 1);
    assert.equal(ruleIds(java).filter((id) => id === 'off-by-one-loop').length, 2);
    assert.ok(!ruleIds(js).includes('off-by-one-loop'), '< is correct and must not be flagged');
  });

  test('JavaScript: ESLint rules for ==, var, eval and undefined variables', async () => {
    const code = 'var x = 1;\nif (x == 1) { eval("x"); }\ny = 2;\n';
    const ids = ruleIds(await analyzeCode(code, 'javascript'));
    for (const id of ['js-eqeqeq', 'js-no-var', 'js-no-eval', 'js-no-undef']) {
      assert.ok(ids.includes(id), `expected ${id}`);
    }
  });

  test('clean code produces no high-severity findings', async () => {
    const code = 'def add(a: int, b: int) -> int:\n    """Add two numbers."""\n    return a + b\n';
    const result = await analyzeCode(code, 'python');
    assert.equal(result.issues.filter((issue) => ['CRITICAL', 'HIGH'].includes(issue.severity)).length, 0);
  });
});

describe('Metrics', () => {
  test('computes McCabe cyclomatic complexity per function', async () => {
    // 1 (base) + if + elif + for + and = 5
    const code = [
      'def grade(x, items):',
      '    if x > 90 and x <= 100:',
      '        return "A"',
      '    elif x > 80:',
      '        return "B"',
      '    for i in items:',
      '        print(i)',
      '    return "C"',
    ].join('\n');
    const { metrics } = await analyzeCode(code, 'python');
    assert.equal(metrics.functionCount, 1);
    assert.equal(metrics.functions[0].name, 'grade');
    assert.equal(metrics.functions[0].cyclomatic, 5);
    assert.equal(metrics.functions[0].parameters, 2);
  });

  test('does not count else-if chains as deeper nesting', async () => {
    const code = 'function f(a) {\n  if (a === 1) { return 1; } else if (a === 2) { return 2; } else if (a === 3) { return 3; }\n  return 0;\n}';
    const { metrics } = await analyzeCode(code, 'javascript');
    assert.equal(metrics.functions[0].maxNesting, 1);
    assert.equal(metrics.functions[0].cyclomatic, 4);
  });

  test('flags functions above the complexity threshold', async () => {
    const branches = Array.from({ length: 11 }, (_, i) => `  if (x == ${i}) { y = ${i}; }`).join('\n');
    const code = `int f(int x) {\n  int y = 0;\n${branches}\n  return y;\n}`;
    const result = await analyzeCode(code, 'cpp');
    assert.ok(ruleIds(result).includes('high-cyclomatic-complexity'));
    assert.equal(result.metrics.maxCyclomatic, 12);
  });

  test('counts lines without the trailing newline', async () => {
    const { metrics } = await analyzeCode('# comment\n\nx = 1\n', 'python');
    assert.equal(metrics.totalLines, 3);
    assert.equal(metrics.commentLines, 1);
    assert.equal(metrics.blankLines, 1);
    assert.equal(metrics.codeLines, 1);
  });
});
