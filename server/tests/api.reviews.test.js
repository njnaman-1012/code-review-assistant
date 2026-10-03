import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AiServiceError } from '../utils/AppError.js';
import { createTestApp, createTestProvider, validAiReview, PYTHON_CODE } from './helpers.js';

function postReview(agent, body) {
  return agent.post('/api/reviews').send(body);
}

describe('POST /api/reviews - review creation', () => {
  test('creates a complete review with static + AI results', async () => {
    const provider = createTestProvider(validAiReview());
    const { agent } = await createTestApp({ provider });
    const res = await postReview(agent, { language: 'python', code: PYTHON_CODE });

    assert.equal(res.status, 201);
    const review = res.body.data;
    assert.ok(review.id > 0);
    assert.equal(review.language, 'python');
    assert.equal(review.ai.status, 'completed');
    assert.equal(review.summary, 'Computes the average of a list of numbers.');
    assert.equal(review.logic.steps.length, 3);
    assert.ok(review.improvedCode.includes('raise ValueError'));
    assert.equal(review.complexity.originalTime, 'O(n)');

    // Static and AI issues are both present and clearly labelled.
    const sources = new Set(review.issues.map((issue) => issue.source));
    assert.ok(sources.has('static'), 'static issues present');
    assert.ok(sources.has('ai'), 'AI issues present');
    assert.ok(review.issues.some((issue) => issue.ruleId === 'python-mutable-default'));

    // Improved code was re-checked by the static analyzer.
    assert.ok(review.comparison);
    assert.ok(review.comparison.improved.staticIssueCount < review.comparison.original.staticIssueCount);

    // The prompt sent to the AI contains numbered code and static findings.
    assert.equal(provider.calls.length, 1);
    assert.match(provider.calls[0].prompt, /3 \| def average/);
    assert.match(provider.calls[0].prompt, /Mutable default argument/);
  });

  test('accepts language aliases such as "C++" and "js"', async () => {
    const { agent } = await createTestApp();
    const cpp = await postReview(agent, { language: 'C++', code: 'int main() { return 0; }' });
    const js = await postReview(agent, { language: 'js', code: 'console.log(1);' });
    assert.equal(cpp.status, 201);
    assert.equal(cpp.body.data.language, 'cpp');
    assert.equal(js.body.data.language, 'javascript');
  });

  test('works without an AI provider (static analysis only)', async () => {
    const { agent } = await createTestApp();
    const res = await postReview(agent, { language: 'python', code: PYTHON_CODE });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.ai.status, 'unavailable');
    assert.ok(res.body.data.issues.length > 0);
    assert.equal(res.body.data.improvedCode, '');
    assert.equal(res.body.data.comparison, null);
  });

  test('falls back to static analysis when the AI call fails', async () => {
    const provider = createTestProvider(new AiServiceError('AI_TIMEOUT', 'took too long (check AI_TIMEOUT_MS in server/.env).'));
    const { agent } = await createTestApp({ provider });
    const res = await postReview(agent, { language: 'python', code: PYTHON_CODE });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.ai.status, 'failed');
    assert.match(res.body.data.ai.message, /took too long/);
    // The public message must not leak internal details.
    assert.ok(!/server\/\.env|AI_|test-provider/.test(res.body.data.ai.message));
    assert.ok(res.body.data.issues.every((issue) => issue.source === 'static'));
  });

  test('review responses never reveal which AI provider or model was used', async () => {
    const { agent } = await createTestApp({ provider: createTestProvider(validAiReview()) });
    const { id } = (await postReview(agent, { language: 'python', code: PYTHON_CODE })).body.data;
    for (const res of [await agent.get(`/api/reviews/${id}`), await agent.get('/api/reviews')]) {
      const body = JSON.stringify(res.body);
      assert.ok(!body.includes('test-model') && !body.includes('test-provider'), 'no provider/model in API output');
    }
    const html = await agent.get(`/api/reviews/${id}/report?format=html`);
    assert.ok(!html.text.includes('test-model') && !html.text.includes('Tree-sitter'));
  });

  test('retries once when the AI returns invalid JSON', async () => {
    const provider = createTestProvider((call) => (call === 1 ? 'this is not json' : validAiReview()));
    const { agent } = await createTestApp({ provider });
    const res = await postReview(agent, { language: 'python', code: PYTHON_CODE });
    assert.equal(provider.calls.length, 2);
    assert.equal(res.body.data.ai.status, 'completed');
    assert.match(provider.calls[1].prompt, /previous answer could not be used/);
  });

  test('marks AI as failed when every attempt returns an invalid response', async () => {
    const provider = createTestProvider({ summary: '' });
    const { agent } = await createTestApp({ provider });
    const res = await postReview(agent, { language: 'python', code: PYTHON_CODE });
    assert.equal(res.status, 201);
    assert.equal(provider.calls.length, 2);
    assert.equal(res.body.data.ai.status, 'failed');
  });
});

const { agent: validationAgent } = await createTestApp();

describe('POST /api/reviews - validation', () => {
  const agent = validationAgent;

  test('rejects empty code', async () => {
    const res = await postReview(agent, { language: 'python', code: '' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'EMPTY_CODE');
  });

  test('rejects whitespace-only code', async () => {
    const res = await postReview(agent, { language: 'python', code: '   \n\t ' });
    assert.equal(res.body.error.code, 'EMPTY_CODE');
  });

  test('rejects an unsupported language', async () => {
    const res = await postReview(agent, { language: 'ruby', code: 'puts "hi"' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'UNSUPPORTED_LANGUAGE');
    assert.match(res.body.error.message, /Python, Java, C\+\+, JavaScript/);
  });

  test('rejects a missing language', async () => {
    const res = await postReview(agent, { code: 'print(1)' });
    assert.equal(res.body.error.code, 'LANGUAGE_REQUIRED');
  });

  test('rejects code that is too large', async () => {
    const res = await postReview(agent, { language: 'python', code: 'x = 1\n'.repeat(5000) });
    assert.equal(res.status, 413);
    assert.equal(res.body.error.code, 'CODE_TOO_LARGE');
  });

  test('rejects binary content', async () => {
    const res = await postReview(agent, { language: 'python', code: 'abc\u0000def' });
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  });

  test('rejects malformed JSON without exposing a stack trace', async () => {
    const res = await agent.post('/api/reviews').set('Content-Type', 'application/json').send('{"language":');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_JSON');
    assert.ok(!JSON.stringify(res.body).includes('at '), 'no stack trace in response');
  });
});

describe('Review retrieval, listing, deletion and reports', () => {
  test('lists, retrieves and deletes reviews', async () => {
    const { agent } = await createTestApp({ provider: createTestProvider(validAiReview()) });
    const created = (await postReview(agent, { language: 'python', code: PYTHON_CODE })).body.data;
    await postReview(agent, { language: 'javascript', code: 'var a = 1;' });

    const list = await agent.get('/api/reviews');
    assert.equal(list.status, 200);
    assert.equal(list.body.data.total, 2);
    assert.equal(list.body.data.reviews[0].language, 'javascript'); // newest first
    assert.ok('issueCount' in list.body.data.reviews[0]);

    const one = await agent.get(`/api/reviews/${created.id}`);
    assert.equal(one.status, 200);
    assert.equal(one.body.data.originalCode, PYTHON_CODE);
    assert.deepEqual(one.body.data.issues, created.issues);

    const deleted = await agent.delete(`/api/reviews/${created.id}`);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.data.deleted, true);

    const missing = await agent.get(`/api/reviews/${created.id}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'REVIEW_NOT_FOUND');

    const deleteAgain = await agent.delete(`/api/reviews/${created.id}`);
    assert.equal(deleteAgain.status, 404);
  });

  test('rejects invalid review ids', async () => {
    const { agent } = await createTestApp();
    const res = await agent.get('/api/reviews/abc');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_ID');
  });

  test('downloads HTML and Markdown reports', async () => {
    const { agent } = await createTestApp({ provider: createTestProvider(validAiReview()) });
    const { id } = (await postReview(agent, { language: 'python', code: PYTHON_CODE })).body.data;

    const html = await agent.get(`/api/reviews/${id}/report?format=html`);
    assert.equal(html.status, 200);
    assert.match(html.headers['content-type'], /text\/html/);
    assert.match(html.headers['content-disposition'], /code-review-\d+\.html/);
    for (const section of ['Original Code', 'Code Summary', 'Logic Explanation', 'Issues Detected', 'Suggestions',
      'Improved Code', 'Explanation of Improvements', 'Complexity Analysis', 'Final Summary']) {
      assert.ok(html.text.includes(section), `report contains "${section}"`);
    }

    const md = await agent.get(`/api/reviews/${id}/report?format=md`);
    assert.match(md.headers['content-type'], /text\/markdown/);
    assert.match(md.text, /^# Code Review Assistant/);

    const bad = await agent.get(`/api/reviews/${id}/report?format=pdf`);
    assert.equal(bad.status, 400);
  });

  test('HTML report escapes user code (no script injection)', async () => {
    const { agent } = await createTestApp();
    const code = 'console.log("</script><script>alert(1)</script>");';
    const { id } = (await postReview(agent, { language: 'javascript', code })).body.data;
    const html = await agent.get(`/api/reviews/${id}/report?format=html`);
    assert.ok(!html.text.includes('<script>alert(1)</script>'));
    assert.ok(html.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });
});
