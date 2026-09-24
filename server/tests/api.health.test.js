import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, createTestProvider, validAiReview } from './helpers.js';

test('GET /api/health reports service and AI availability', async () => {
  const { app } = createTestApp();
  const res = await request(app).get('/api/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'ok');
  assert.equal(res.body.data.ai.available, false);
  assert.deepEqual(res.body.data.languages.map((l) => l.value), ['python', 'java', 'cpp', 'javascript']);
});

test('GET /api/health does not reveal internal details', async () => {
  const { app } = createTestApp({ provider: createTestProvider(validAiReview()) });
  const res = await request(app).get('/api/health');
  assert.deepEqual(res.body.data.ai, { available: true });
  const body = JSON.stringify(res.body);
  for (const secret of ['test-model', 'test-provider', 'database', 'uptime', 'chain']) {
    assert.ok(!body.includes(secret), `health response must not contain "${secret}"`);
  }
});

test('unknown API routes return a JSON 404', async () => {
  const { app } = createTestApp();
  const res = await request(app).get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('security headers are set and x-powered-by is hidden', async () => {
  const { app } = createTestApp();
  const res = await request(app).get('/api/health');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});
