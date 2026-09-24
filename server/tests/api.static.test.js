// Production mode: the API server also serves the built React app.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createDatabase } from '../database/db.js';
import { createApp } from '../app.js';
import { createAiReviewService } from '../services/aiReviewService.js';
import { testConfig } from './helpers.js';

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cra-dist-'));
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
fs.mkdirSync(path.join(dist, 'assets'));
fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1);');
after(() => fs.rmSync(dist, { recursive: true, force: true }));

const app = createApp({
  db: createDatabase(':memory:'),
  aiReviewService: createAiReviewService(null),
  config: { ...testConfig, clientDistPath: dist },
});

describe('Serving the built frontend (production)', () => {
  test('serves index.html for the home page and for React routes', async () => {
    for (const url of ['/', '/reviews/5', '/history']) {
      const res = await request(app).get(url);
      assert.equal(res.status, 200, url);
      assert.match(res.text, /<div id="root">/);
    }
  });

  test('serves static assets', async () => {
    const res = await request(app).get('/assets/app.js');
    assert.equal(res.status, 200);
    assert.match(res.text, /console\.log/);
  });

  test('API routes still work and unknown API routes are still JSON 404s', async () => {
    assert.equal((await request(app).get('/api/health')).status, 200);
    const missing = await request(app).get('/api/unknown');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
  });
});
