// The AI token allowance of each user: accounting, limits and manipulation attempts.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { config, DEFAULT_USER_TOKENS } from '../config/config.js';
import { TOKEN_LIMIT_MESSAGE } from '../services/usageService.js';
import { AiServiceError } from '../utils/AppError.js';
import {
  createTestApp, createTestProvider, createRoutingProvider, registerUser, lastCode, clearRateLimits, validAiReview, PYTHON_CODE, TEST_PASSWORD,
} from './helpers.js';

const postReview = (agent, extra = {}) => agent.post('/api/reviews').send({ language: 'python', code: PYTHON_CODE, ...extra });
const usageOf = async (agent) => (await agent.get('/api/auth/me')).body.data.usage;
const setBalance = (db, userId, remaining) => db.execute({
  sql: 'UPDATE user_ai_usage SET tokens_remaining = ?, tokens_used = tokens_allocated - ? WHERE user_id = ?',
  args: [remaining, remaining, userId],
});

// A complete corrected file for PYTHON_CODE (accepted by the completeness checks).
const CORRECTED = 'import os\n\ndef average(values=None):\n    if not values:\n        return 0\n    total = 0\n    for v in values:\n        total += v\n    return total / len(values)\n';
const correction = {
  action: 'correct',
  language: 'python',
  correctedCode: CORRECTED,
  changes: [{ title: 'Handled the empty list', explanation: 'Return 0 for no values.', problemSolved: 'No division by zero.', lines: '3-5' }],
  summary: 'Fixed the division by zero.',
};

// An AI service that reports 2,500 tokens for every request.
function meteredProvider(handlers = {}) {
  const provider = createRoutingProvider({ review: validAiReview(), correct: correction, ...handlers });
  provider.usage = { totalTokens: 2500 };
  return provider;
}

describe('Token allowance', () => {
  test('the default allowance is defined in one place', async () => {
    assert.equal(DEFAULT_USER_TOKENS, 100000);
    assert.equal(config.usage.defaultUserTokens, Number(process.env.DEFAULT_USER_TOKENS) || DEFAULT_USER_TOKENS);

    // Changing the configured value changes what a new user receives.
    const { app } = await createTestApp({ config: { usage: { defaultUserTokens: 5000 } } });
    const { usage } = await registerUser(app, 'small@example.com');
    assert.deepEqual(usage, { allocated: 5000, used: 0, remaining: 5000, percentRemaining: 100 });
  });

  test('an AI request of 2,500 tokens leaves 97,500 of 100,000', async () => {
    const provider = meteredProvider();
    const { agent, db, user } = await createTestApp({ provider });
    assert.deepEqual(await usageOf(agent), { allocated: 100000, used: 0, remaining: 100000, percentRemaining: 100 });

    const res = await postReview(agent);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.ai.status, 'completed');
    const expected = { allocated: 100000, used: 2500, remaining: 97500, percentRemaining: 97.5 };
    assert.deepEqual(res.body.usage, expected, 'the response carries the new balance for the token bar');
    assert.deepEqual(await usageOf(agent), expected);

    // The database is the source of truth, and every request is logged.
    const { rows } = await db.execute({ sql: 'SELECT * FROM user_ai_usage WHERE user_id = ?', args: [user.id] });
    assert.equal(rows[0].tokens_allocated, 100000);
    assert.equal(rows[0].tokens_used, 2500);
    assert.equal(rows[0].tokens_remaining, 97500);
    const logs = (await db.execute('SELECT * FROM ai_usage_logs')).rows;
    assert.equal(logs.length, 1);
    assert.equal(logs[0].user_id, user.id);
    assert.equal(logs[0].feature, 'review');
    assert.equal(logs[0].tokens_used, 2500);
    assert.match(logs[0].request_id, /^[0-9a-f-]{36}$/);

    // "Fix / Correct Code" is charged in the same way.
    const fixed = await agent.post(`/api/reviews/${res.body.data.id}/correct`).send({});
    assert.equal(fixed.status, 200);
    assert.deepEqual(fixed.body.usage, { allocated: 100000, used: 5000, remaining: 95000, percentRemaining: 95 });
    const features = (await db.execute('SELECT feature FROM ai_usage_logs ORDER BY id')).rows.map((row) => row.feature);
    assert.deepEqual(features, ['review', 'correct']);
  });

  test('rejected AI answers are charged too, and requests without AI cost nothing', async () => {
    const provider = meteredProvider({ review: (call) => (call === 1 ? 'not json' : validAiReview()) });
    const { agent } = await createTestApp({ provider });
    await postReview(agent);
    assert.equal(provider.calls.length, 2);
    assert.equal((await usageOf(agent)).used, 5000, 'both attempts');

    await agent.get('/api/reviews');
    await agent.get('/api/reviews/1');
    await agent.get('/api/reviews/1/report?format=md');
    assert.equal((await usageOf(agent)).used, 5000);

    // No AI configured: the review uses the automated checks only and is free.
    const noAi = await createTestApp();
    assert.equal((await postReview(noAi.agent)).status, 201);
    assert.equal((await usageOf(noAi.agent)).used, 0);
  });

  test('an AI service that reports no usage is charged by estimate', async () => {
    const provider = createTestProvider(validAiReview()); // no usage in the answer
    const { agent } = await createTestApp({ provider });
    await postReview(agent);
    const usage = await usageOf(agent);
    assert.ok(usage.used > 300, 'prompt and answer were counted');
    assert.equal(usage.used + usage.remaining, usage.allocated);
  });

  test('the allowance is given once, when the e-mail address is verified', async () => {
    const { app, db, outbox } = await createTestApp();
    const usageRows = async () => (await db.execute("SELECT COUNT(*) AS n FROM user_ai_usage WHERE user_id = (SELECT id FROM users WHERE email = 'later@example.com')")).rows[0].n;
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email: 'later@example.com', password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
    assert.equal(await usageRows(), 0, 'an unverified account has no AI tokens');
    await agent.post('/api/auth/verify-email').send({ otp: lastCode(outbox, 'later@example.com') });
    assert.equal(await usageRows(), 1);
    assert.equal((await usageOf(agent)).remaining, 100000);
  });

  test('each user has an own balance', async () => {
    const { app, agent: alice } = await createTestApp({ provider: meteredProvider() });
    const { agent: bob } = await registerUser(app, 'bob@example.com');
    await postReview(alice);
    await postReview(alice);
    assert.equal((await usageOf(alice)).remaining, 95000);
    assert.equal((await usageOf(bob)).remaining, 100000);
  });
});

describe('Token manipulation attempts', () => {
  test('token numbers and user IDs sent by the browser are ignored', async () => {
    const provider = meteredProvider();
    const { app, agent, db, user, outbox } = await createTestApp({ provider });
    const fake = { tokens_remaining: 999999999, tokensRemaining: 999999999, tokens_allocated: 999999999, tokens_used: 0, tokensUsed: 0, usage: { remaining: 999999999 } };

    // Registration and verification cannot choose their own allowance.
    const greedy = request.agent(app);
    await greedy.post('/api/auth/register')
      .send({ email: 'greedy@example.com', password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD, ...fake, tokens: 999999999 });
    const verified = await greedy.post('/api/auth/verify-email').send({ otp: lastCode(outbox, 'greedy@example.com'), ...fake, tokens: 999999999 });
    assert.deepEqual(verified.body.data.usage, { allocated: 100000, used: 0, remaining: 100000, percentRemaining: 100 });

    // Fake numbers in the body, query string, headers and cookies of an AI request.
    agent.jar.setCookie('tokens_remaining=999999999', '127.0.0.1', '/');
    agent.jar.setCookie('tokens_used=0', '127.0.0.1', '/');
    const res = await agent.post('/api/reviews?tokens_remaining=999999999&tokensUsed=0')
      .set('X-Tokens-Remaining', '999999999')
      .send({ language: 'python', code: PYTHON_CODE, ...fake, userId: 9999, user_id: 9999 });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.usage, { allocated: 100000, used: 2500, remaining: 97500, percentRemaining: 97.5 });
    const { rows } = await db.execute({ sql: 'SELECT tokens_remaining FROM user_ai_usage WHERE user_id = ?', args: [user.id] });
    assert.equal(rows[0].tokens_remaining, 97500);
  });

  test('there is no API to change a balance', async () => {
    const { agent } = await createTestApp({ provider: meteredProvider() });
    await postReview(agent);
    const body = { tokens_remaining: 100000, tokens_used: 0, remaining: 100000 };
    const attempts = [
      agent.post('/api/auth/me').send(body),
      agent.put('/api/auth/me').send(body),
      agent.patch('/api/auth/me').send(body),
      agent.post('/api/usage').send(body),
      agent.put('/api/usage').send(body),
      agent.post('/api/auth/usage').send(body),
      agent.delete('/api/auth/usage'),
    ];
    for (const res of await Promise.all(attempts)) assert.equal(res.status, 404);
    assert.equal((await usageOf(agent)).remaining, 97500);
  });

  test('logging out, logging in again and refreshing do not reset the balance', async () => {
    const { app, agent, db, user } = await createTestApp({ provider: meteredProvider() });
    await postReview(agent);

    for (let i = 0; i < 3; i += 1) assert.equal((await usageOf(agent)).remaining, 97500, 'refresh');
    await agent.post('/api/auth/logout').send({});

    const again = request.agent(app);
    const login = await again.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    assert.equal(login.body.data.usage.remaining, 97500);
    assert.equal((await usageOf(again)).used, 2500);

    // Registering the same e-mail again does not create a fresh allowance.
    await clearRateLimits(db);
    await request(app).post('/api/auth/register').send({ email: user.email, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
    assert.equal((await usageOf(again)).remaining, 97500);
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM user_ai_usage')).rows[0].n, 1);
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM users')).rows[0].n, 1);
  });
});

describe('Token exhaustion', () => {
  test('with no tokens left the AI is not called', async () => {
    const provider = meteredProvider();
    const { agent, db, user } = await createTestApp({ provider });
    const { id } = (await postReview(agent)).body.data;
    assert.equal(provider.calls.length, 1);

    await setBalance(db, user.id, 0);
    const empty = { allocated: 100000, used: 100000, remaining: 0, percentRemaining: 0 };
    assert.deepEqual(await usageOf(agent), empty);

    // A new review still runs the automated checks, but without the AI.
    const review = await postReview(agent);
    assert.equal(review.status, 201);
    assert.equal(review.body.data.ai.status, 'unavailable');
    assert.ok(review.body.data.ai.message.startsWith(TOKEN_LIMIT_MESSAGE));
    assert.equal(review.body.data.improvedCode, '');
    assert.ok(review.body.data.issues.every((issue) => issue.source === 'static'));
    assert.deepEqual(review.body.usage, empty);

    // "Fix / Correct Code" and "Improve Code" are refused with the limit message.
    for (const action of ['correct', 'improve']) {
      const res = await agent.post(`/api/reviews/${id}/${action}`).send({});
      assert.equal(res.status, 429);
      assert.equal(res.body.error.code, 'TOKEN_LIMIT_REACHED');
      assert.equal(res.body.error.message, 'You have reached your AI usage limit. Please wait for your allowance to reset or contact the administrator.');
    }

    assert.equal(provider.calls.length, 1, 'no AI request after the allowance was used up');
    assert.deepEqual(await usageOf(agent), empty, 'the balance did not change and never goes below zero');
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM ai_usage_logs')).rows[0].n, 1);
  });

  test('a request that needs more tokens than are left is refused before the AI is called', async () => {
    const provider = meteredProvider();
    const { agent, db, user } = await createTestApp({ provider });
    await setBalance(db, user.id, 200); // far less than one request needs
    const review = await postReview(agent);
    assert.ok(review.body.data.ai.message.startsWith(TOKEN_LIMIT_MESSAGE));
    assert.equal(provider.calls.length, 0);
    assert.equal((await usageOf(agent)).remaining, 200, 'nothing was deducted');
  });

  test('the balance stops at zero when a request uses more than what is left', async () => {
    const provider = meteredProvider();
    const { agent, db, user } = await createTestApp({ provider });
    await setBalance(db, user.id, 2000); // enough to start, but the request uses 2,500
    assert.equal((await postReview(agent)).body.data.ai.status, 'completed');
    assert.deepEqual(await usageOf(agent), { allocated: 100000, used: 100000, remaining: 0, percentRemaining: 0 });
    assert.ok((await postReview(agent)).body.data.ai.message.startsWith(TOKEN_LIMIT_MESSAGE));
    assert.equal(provider.calls.length, 1);
  });

  test('requests sent at the same moment cannot spend the same tokens twice', async () => {
    const provider = meteredProvider();
    const { agent, db, user } = await createTestApp({ provider });
    await setBalance(db, user.id, 2000); // enough for one request only
    const results = await Promise.all([postReview(agent), postReview(agent), postReview(agent)]);
    assert.equal(results.filter((res) => res.body.data.ai.status === 'completed').length, 1);
    assert.equal(provider.calls.length, 1);
    assert.equal((await usageOf(agent)).remaining, 0);
  });

  test('a failed AI request gives the reserved tokens back', async () => {
    const provider = createRoutingProvider({ review: new AiServiceError('AI_UNAVAILABLE', 'could not be reached.') });
    const { agent } = await createTestApp({ provider });
    const res = await postReview(agent);
    assert.equal(res.body.data.ai.status, 'failed');
    assert.deepEqual(await usageOf(agent), { allocated: 100000, used: 0, remaining: 100000, percentRemaining: 100 });
  });
});
