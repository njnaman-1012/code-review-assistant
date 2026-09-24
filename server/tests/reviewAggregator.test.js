import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateQualityScore, gradeFor, mergeIssues, buildComparison, verifyAiIssue } from '../services/reviewAggregator.js';

const staticIssue = (overrides) => ({
  ruleId: 'r', title: 'Unused variable "x"', type: 'Maintainability Issue', severity: 'LOW', line: 5,
  confidence: 'confirmed', source: 'static', ...overrides,
});
const aiIssue = (overrides) => ({
  title: 'Division by zero', type: 'Runtime Risk', severity: 'HIGH', line: 9, code: '', explanation: 'e',
  impact: 'i', suggestion: 's', confidence: 'likely', ...overrides,
});

test('quality score follows the documented formula', () => {
  assert.equal(calculateQualityScore([]), 100);
  assert.equal(calculateQualityScore([{ severity: 'CRITICAL' }, { severity: 'HIGH' }, { severity: 'MEDIUM' }, { severity: 'LOW' }]), 63);
  assert.equal(calculateQualityScore([{ severity: 'HIGH', confidence: 'possible' }]), 95);
  assert.equal(calculateQualityScore(Array(10).fill({ severity: 'CRITICAL' })), 0);
  assert.deepEqual([95, 80, 65, 45, 10].map(gradeFor), ['A', 'B', 'C', 'D', 'F']);
});

test('mergeIssues removes AI duplicates of static findings and sorts by severity', () => {
  const merged = mergeIssues(
    [staticIssue()],
    [aiIssue(), aiIssue({ title: 'Variable x is unused', type: 'Maintainability Issue', severity: 'LOW', line: 5 })],
    { syntaxValid: true },
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].severity, 'HIGH');
  assert.equal(merged[0].source, 'ai');
  assert.deepEqual(merged.map((issue) => issue.id), ['ISSUE-1', 'ISSUE-2']);
});

test('AI syntax errors are downgraded when the parser found none', () => {
  const [issue] = mergeIssues([], [aiIssue({ type: 'Syntax Error', severity: 'CRITICAL', confidence: 'confirmed' })], { syntaxValid: true });
  assert.equal(issue.confidence, 'possible');
  assert.match(issue.explanation, /parser did not detect/);
});

describe('AI claim verification', () => {
  const lines = ['def total(values):', '    return sum(values)', '', 'print(total([1, 2]))'];
  const context = { syntaxValid: true, lines, definedFunctions: new Set(['total']) };

  test('keeps a well-grounded AI issue unchanged', () => {
    const issue = aiIssue({ line: 2, code: '    return sum(values)', confidence: 'likely' });
    assert.deepEqual(verifyAiIssue(issue, context), issue);
  });

  test('downgrades an issue whose quoted code is not in the submission', () => {
    const result = verifyAiIssue(aiIssue({ line: 2, code: 'return total / count', confidence: 'confirmed' }), context);
    assert.equal(result.confidence, 'possible');
    assert.match(result.explanation, /quoted code was not found/);
  });

  test('clears a line number that does not exist', () => {
    const result = verifyAiIssue(aiIssue({ line: 99, code: '' }), context);
    assert.equal(result.line, null);
    assert.equal(result.confidence, 'possible');
  });

  test('contradicts "undefined function" claims when the parser found the definition', () => {
    const result = verifyAiIssue(aiIssue({
      title: 'Undefined function call', explanation: 'total is not defined', line: 4, code: 'print(total([1, 2]))', confidence: 'confirmed',
    }), context);
    assert.equal(result.confidence, 'possible');
    assert.match(result.explanation, /found a definition of total/);
  });
});

test('buildComparison reports changes between original and improved code', () => {
  const make = (issues, maxCyclomatic, syntaxValid = true) => ({
    syntaxValid,
    issues: Array(issues).fill({}),
    metrics: { totalLines: 10, codeLines: 8, functionCount: 1, maxCyclomatic, averageCyclomatic: maxCyclomatic, maxNesting: 2 },
  });
  const comparison = buildComparison(make(5, 12), make(1, 4));
  assert.equal(comparison.original.staticIssueCount, 5);
  assert.equal(comparison.improved.staticIssueCount, 1);
  assert.ok(comparison.notes.some((note) => note.includes('from 12 to 4')));
  assert.equal(buildComparison(make(1, 1), null), null);
  assert.ok(buildComparison(make(1, 1), make(1, 1, false)).notes[0].startsWith('Warning'));
});
