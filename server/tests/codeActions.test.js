// "Fix / Correct Code" and "Improve Code": the complete corrected / improved
// source file, validated before it is shown and saved with the review.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { AiServiceError } from '../utils/AppError.js';
import { createTestApp, createRoutingProvider, validAiReview } from './helpers.js';

// A 60+ line program with one real bug: average() divides by zero for an empty list.
const LONG_CODE = `"""Simple student grade manager."""

PASS_MARK = 40


def read_scores(lines):
    scores = {}
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, value = line.split(",")
        scores[name.strip()] = int(value)
    return scores


def average(values):
    total = 0
    for v in values:
        total += v
    return total / len(values)


def highest(scores):
    best_name = None
    best_score = -1
    for name, score in scores.items():
        if score > best_score:
            best_name = name
            best_score = score
    return best_name, best_score


def grade(score):
    if score >= 90:
        return "A"
    elif score >= 75:
        return "B"
    elif score >= 60:
        return "C"
    elif score >= PASS_MARK:
        return "D"
    return "F"


def passed_students(scores):
    result = []
    for name in scores:
        if scores[name] >= PASS_MARK:
            result.append(name)
    return result


def report(scores):
    print("Students:", len(scores))
    print("Average:", round(average(list(scores.values())), 2))
    name, score = highest(scores)
    print("Top student:", name, score)
    for name in sorted(scores):
        print(name, scores[name], grade(scores[name]))
    print("Passed:", ", ".join(passed_students(scores)))


if __name__ == "__main__":
    data = ["alice, 91", "bob, 58", "carol, 77", "# comment", "dave, 35"]
    report(read_scores(data))
`;

const BUGGY_AVERAGE = `def average(values):
    total = 0
    for v in values:
        total += v
    return total / len(values)`;

const FIXED_AVERAGE = `def average(values):
    if not values:
        return 0.0
    total = 0
    for v in values:
        total += v
    return total / len(values)`;

const CORRECTED_CODE = LONG_CODE.replace(BUGGY_AVERAGE, FIXED_AVERAGE);

const IMPROVED_CODE = LONG_CODE
  .replace(BUGGY_AVERAGE, 'def average(values):\n    """Return the mean of the values (0.0 for an empty list)."""\n    return sum(values) / len(values) if values else 0.0')
  .replace(/def passed_students\(scores\):[\s\S]*?return result/, 'def passed_students(scores):\n    return [name for name, score in scores.items() if score >= PASS_MARK]');

const correction = (overrides = {}) => ({
  action: 'correct',
  language: 'python',
  correctedCode: CORRECTED_CODE,
  changes: [{
    title: 'Fixed division by zero in average()',
    explanation: 'Added a check for an empty list before dividing.',
    problemSolved: 'average([]) no longer raises ZeroDivisionError.',
    lines: '17-21',
  }],
  summary: 'The code was corrected while preserving its intended functionality.',
  ...overrides,
});

const improvement = (overrides = {}) => ({
  action: 'improve',
  language: 'python',
  improvedCode: IMPROVED_CODE,
  changes: [
    { title: 'Simplified average()', explanation: 'Uses the built-in sum().', problemSolved: 'Less code and no division by zero.', lines: '17-21' },
    { title: 'List comprehension in passed_students()', explanation: 'Replaces the manual loop.', problemSolved: 'Easier to read.', lines: '46-51' },
  ],
  summary: 'The code was improved for readability, maintainability and efficiency.',
  ...overrides,
});

// Only the changed function - NOT a complete file.
const SNIPPET_ONLY = correction({ correctedCode: FIXED_AVERAGE });

const nonBlankLines = (code) => code.split('\n').filter((line) => line.trim()).length;

async function setup(handlers) {
  const provider = createRoutingProvider({ review: validAiReview(), ...handlers });
  const { app, db } = await createTestApp({ provider });
  const created = await request(app).post('/api/reviews').send({ language: 'python', code: LONG_CODE });
  assert.equal(created.status, 201, 'review creation still works');
  return { app, db, provider, review: created.body.data };
}

// Sends the same body as the browser client (an empty JSON object).
const post = (app, id, action) => request(app).post(`/api/reviews/${id}/${action}`).send({});

describe('Fix / Correct Code', () => {
  test('returns the COMPLETE corrected file for a 60+ line program, not only the changed lines', async () => {
    const { app, provider, review } = await setup({ correct: correction() });
    assert.deepEqual(review.codeActions, { correct: null, improve: null }, 'a new review has no generated code yet');

    const res = await post(app, review.id, 'correct');
    assert.equal(res.status, 200);
    const result = res.body.data;
    assert.equal(result.action, 'correct');
    assert.equal(result.language, 'python');
    assert.equal(result.code, CORRECTED_CODE, 'the whole file with the fix applied');
    assert.ok(nonBlankLines(result.code) >= nonBlankLines(LONG_CODE), 'no line of the original was dropped');
    for (const fn of ['read_scores', 'average', 'highest', 'grade', 'passed_students', 'report']) {
      assert.ok(result.code.includes(`def ${fn}(`), `function ${fn} is still present`);
    }
    assert.ok(result.code.includes('if not values:'), 'the fix is applied');
    assert.equal(result.changes[0].title, 'Fixed division by zero in average()');
    assert.equal(result.changes[0].problemSolved, 'average([]) no longer raises ZeroDivisionError.');
    assert.equal(result.checks.syntaxValid, true, 'the generated code was re-checked by the parser');
    assert.ok(result.generatedAt);

    // The AI got the whole context and the complete-code rules.
    const [call] = provider.callsFor('correct');
    assert.match(call.system, /You must return the COMPLETE source code/);
    assert.match(call.system, /Do not return only modified lines/);
    assert.match(call.prompt, /FIX \/ CORRECT THE CODE/);
    assert.match(call.prompt, / 1 \| """Simple student grade manager\."""/, 'numbered original code');
    assert.match(call.prompt, /REVIEW ISSUES/);
    assert.match(call.prompt, /Division by zero for an empty list/, 'issues from the AI review');
    assert.match(call.prompt, /STATIC ANALYSIS RESULTS/);
  });

  test('a snippet with only the changed lines is rejected and the AI is asked again', async () => {
    const { app, provider, review } = await setup({ correct: (n) => (n === 1 ? SNIPPET_ONLY : correction()) });
    const res = await post(app, review.id, 'correct');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.code, CORRECTED_CODE);
    const calls = provider.callsFor('correct');
    assert.equal(calls.length, 2);
    assert.match(calls[1].prompt, /your previous answer could not be used/);
    assert.match(calls[1].prompt, /not the complete file/);
  });

  test('placeholder answers are never shown as complete code', async () => {
    const placeholders = [
      CORRECTED_CODE.replace(/def grade\(score\):[\s\S]*?return "F"/, '# ... rest of the code unchanged'),
      CORRECTED_CODE.replace(/def highest\(scores\):[\s\S]*?return best_name, best_score/, '# existing code remains unchanged'),
      CORRECTED_CODE.replace(/def report\(scores\):[\s\S]*?passed_students\(scores\)\)\)/, '...'),
      `Here is the corrected portion:\n${CORRECTED_CODE}`,
    ];
    for (const code of placeholders) {
      const { app, db, review } = await setup({ correct: correction({ correctedCode: code }) });
      const res = await post(app, review.id, 'correct');
      assert.equal(res.status, 502, `rejected: ${code.slice(0, 40)}`);
      assert.equal(res.body.error.code, 'AI_INCOMPLETE_CODE');
      assert.match(res.body.error.message, /did not return the complete source code/);
      assert.equal((await db.execute('SELECT COUNT(*) AS n FROM code_actions')).rows[0].n, 0, 'nothing was saved');
    }
  });

  test('code with a syntax error (for example a cut-off answer) is rejected', async () => {
    const cutOff = CORRECTED_CODE.slice(0, CORRECTED_CODE.indexOf('print("Top student:", name, score)') + 30);
    const { app, review } = await setup({ correct: correction({ correctedCode: cutOff }) });
    const res = await post(app, review.id, 'correct');
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'AI_INCOMPLETE_CODE');
  });

  test('an empty code answer is rejected', async () => {
    const { app, review } = await setup({ correct: correction({ correctedCode: '   ' }) });
    const res = await post(app, review.id, 'correct');
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'AI_EMPTY_CODE');
  });

  test('an invalid (non-JSON) AI answer is rejected', async () => {
    const { app, review } = await setup({ correct: 'Sure! I fixed line 21, just add a check for an empty list.' });
    const res = await post(app, review.id, 'correct');
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'AI_INVALID_RESPONSE');
  });

  test('code in a different programming language is rejected', async () => {
    const { app, review } = await setup({ correct: correction({ language: 'java' }) });
    const res = await post(app, review.id, 'correct');
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'AI_WRONG_LANGUAGE');
  });

  test('an AI API failure returns a clear message without internal details', async () => {
    const { app, review } = await setup({ correct: new AiServiceError('AI_TIMEOUT', 'took too long (check AI_TIMEOUT_MS in server/.env).') });
    const res = await post(app, review.id, 'correct');
    assert.equal(res.status, 504);
    assert.match(res.body.error.message, /took too long/);
    assert.ok(!/server\/\.env|test-provider|test-model|AI_TIMEOUT_MS/.test(JSON.stringify(res.body)));
  });
});

describe('Improve Code', () => {
  test('returns the complete improved file in the same language', async () => {
    const { app, provider, review } = await setup({ improve: improvement() });
    const res = await post(app, review.id, 'improve');
    assert.equal(res.status, 200);
    const result = res.body.data;
    assert.equal(result.action, 'improve');
    assert.equal(result.language, 'python');
    assert.equal(result.code, IMPROVED_CODE);
    assert.ok(result.code.includes('if __name__ == "__main__":'), 'the end of the file is present');
    assert.ok(result.code.startsWith('"""Simple student grade manager."""'), 'the start of the file is present');
    assert.equal(result.changes.length, 2);
    assert.equal(result.checks.syntaxValid, true);

    const [call] = provider.callsFor('improve');
    assert.match(call.prompt, /IMPROVE THE CODE/);
    assert.match(call.prompt, /readability; maintainability; code structure; naming; performance and efficiency/);
    assert.match(call.system, /Return the entire source file from the first line to the last line/);
  });

  test('Fix and Improve are separate AI operations from the review', async () => {
    const { app, provider, review } = await setup({ correct: correction(), improve: improvement() });
    await post(app, review.id, 'correct');
    await post(app, review.id, 'improve');
    assert.deepEqual(provider.calls.map((call) => call.operation), ['review', 'correct', 'improve']);
    assert.notEqual(provider.callsFor('correct')[0].prompt, provider.callsFor('improve')[0].prompt);
  });
});

describe('Saved results', () => {
  test('the original code is unchanged and both results are saved with the review', async () => {
    const { app, review } = await setup({ correct: correction(), improve: improvement() });
    await post(app, review.id, 'correct');
    await post(app, review.id, 'improve');

    const reopened = (await request(app).get(`/api/reviews/${review.id}`)).body.data;
    assert.equal(reopened.originalCode, LONG_CODE, 'original code unchanged');
    assert.equal(reopened.issues.length, review.issues.length, 'review unchanged');
    assert.equal(reopened.improvedCode, review.improvedCode, 'the review\'s own improved code is unchanged');
    assert.equal(reopened.codeActions.correct.code, CORRECTED_CODE);
    assert.equal(reopened.codeActions.improve.code, IMPROVED_CODE);
    assert.equal(reopened.codeActions.correct.changes[0].lines, '17-21');

    const body = JSON.stringify(reopened);
    assert.ok(!body.includes('test-provider') && !body.includes('test-model'), 'no provider/model in API output');
  });

  test('generating again replaces the previous version', async () => {
    const second = CORRECTED_CODE.replace('return 0.0', 'return 0');
    const { app, review } = await setup({ correct: (n) => correction(n === 1 ? {} : { correctedCode: second }) });
    await post(app, review.id, 'correct');
    await post(app, review.id, 'correct');
    const reopened = (await request(app).get(`/api/reviews/${review.id}`)).body.data;
    assert.equal(reopened.codeActions.correct.code, second);
  });

  test('deleting a review also deletes its generated code', async () => {
    const { app, db, review } = await setup({ correct: correction() });
    await post(app, review.id, 'correct');
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM code_actions')).rows[0].n, 1);
    await request(app).delete(`/api/reviews/${review.id}`);
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM code_actions')).rows[0].n, 0);
  });
});

describe('Code action requests', () => {
  test('unknown review -> 404, invalid id -> 400, no AI provider -> 503', async () => {
    const { app } = await setup({});
    assert.equal((await post(app, 999, 'correct')).status, 404);
    assert.equal((await post(app, 'abc', 'improve')).status, 400);

    const noAi = await createTestApp();
    const created = await request(noAi.app).post('/api/reviews').send({ language: 'python', code: LONG_CODE });
    const res = await post(noAi.app, created.body.data.id, 'correct');
    assert.equal(res.status, 503);
    assert.match(res.body.error.message, /not available/);
  });

  test('a duplicate request while the code is being generated is refused', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const { app, provider, review } = await setup({ correct: () => pending.then(() => correction()) });

    const first = post(app, review.id, 'correct').then((res) => res);
    while (!provider.callsFor('correct').length) await new Promise((resolve) => setImmediate(resolve));

    const duplicate = await post(app, review.id, 'correct');
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, 'ACTION_IN_PROGRESS');

    release();
    assert.equal((await first).status, 200);
  });
});
