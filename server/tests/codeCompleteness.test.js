import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findIncompleteCode } from '../services/ai/codeCompleteness.js';
import { validateCodeAction } from '../services/ai/aiResponseValidator.js';
import { AiServiceError } from '../utils/AppError.js';

const ORIGINAL = Array.from({ length: 20 }, (_, i) => `x${i} = compute(${i})`).join('\n');
const check = (generated, action = 'correct', original = ORIGINAL) => findIncompleteCode({ original, generated, action });

describe('Complete-code check', () => {
  test('accepts a complete file', () => {
    assert.equal(check(ORIGINAL.replace('compute(3)', 'compute(3) or 0')), null);
  });

  test('rejects a fragment that only contains the changed lines', () => {
    assert.match(check('x3 = compute(3) or 0'), /fragment/);
  });

  test('an improvement may be shorter, but not a small fragment', () => {
    const shorter = ORIGINAL.split('\n').slice(0, 9).join('\n');
    assert.equal(check(shorter, 'improve'), null);
    assert.match(check(shorter, 'correct'), /fragment/);
    assert.match(check('x3 = 1', 'improve'), /fragment/);
  });

  test('rejects placeholders for left-out code', () => {
    for (const placeholder of ['# ... rest of the code', '// ...', '...', '# rest of the code remains the same',
      '// existing code here', '/* unchanged code */', '[rest of code]', '# other methods unchanged', '// code omitted for brevity']) {
      assert.match(check(`${ORIGINAL}\n${placeholder}`) ?? '', /placeholder/, placeholder);
    }
  });

  test('rejects patches and explanations instead of code', () => {
    assert.match(check(`@@ -3,1 +3,1 @@\n${ORIGINAL}`), /patch/);
    assert.match(check(`Replace line 3 with:\n${ORIGINAL}`), /patch/);
    assert.match(check(`Here is the corrected code:\n${ORIGINAL}`), /explanation/);
  });

  test('does not flag legitimate code', () => {
    // Python "..." that the user wrote, JavaScript spread syntax, ordinary comments.
    const python = `${ORIGINAL}\nclass Base:\n    def run(self):\n        ...`;
    assert.equal(check(python, 'correct', python), null);
    const js = `${ORIGINAL}\nconst merged = {\n  ...defaults,\n  ...options,\n};\n// keep the original order of the items`;
    assert.equal(check(js), null);
  });
});

describe('Code action answer validation', () => {
  test('accepts the documented JSON and strips fences and line numbers', () => {
    const answer = validateCodeAction(JSON.stringify({
      action: 'correct',
      language: 'Python',
      correctedCode: '```python\n1 | x = 1\n2 | print(x)\n```',
      changes: [{ title: 'Fixed x', why: 'It was wrong', benefit: 'Correct output', lines: [1, 2] }, 'Renamed a variable'],
      summary: 'Fixed.',
    }), { action: 'correct', language: 'python' });
    assert.equal(answer.code, 'x = 1\nprint(x)');
    assert.equal(answer.correctedCode, answer.code);
    assert.equal(answer.language, 'python');
    assert.deepEqual(answer.changes[0], { title: 'Fixed x', explanation: 'It was wrong', problemSolved: 'Correct output', lines: '1, 2' });
    assert.equal(answer.changes[1].title, 'Renamed a variable');
  });

  test('rejects missing code, invalid JSON and a different language', () => {
    const expectCode = (fn, code) => assert.throws(fn, (error) => error instanceof AiServiceError && error.code === code);
    expectCode(() => validateCodeAction('{"action":"improve","language":"java","changes":[]}', { action: 'improve', language: 'java' }), 'AI_EMPTY_CODE');
    expectCode(() => validateCodeAction('not json at all', { action: 'improve', language: 'java' }), 'AI_INVALID_RESPONSE');
    expectCode(() => validateCodeAction({ improvedCode: 'int main() { return 0; }', language: 'cpp' }, { action: 'improve', language: 'java' }), 'AI_WRONG_LANGUAGE');
  });
});
