import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, isDatabaseHealthy } from '../database/db.js';
import { createReviewModel } from '../models/reviewModel.js';
import { createUserModel } from '../models/userModel.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

// A review model on an empty database with two registered users.
async function setup() {
  const db = await createDatabase({ url: ':memory:' });
  const users = createUserModel(db);
  const owner = await users.createPending({ email: 'owner@example.com', passwordHash: 'x' });
  const other = await users.createPending({ email: 'other@example.com', passwordHash: 'x' });
  return { model: createReviewModel(db), userId: owner.id, otherUserId: other.id };
}

function sampleReview(overrides = {}) {
  return {
    language: 'python',
    originalCode: 'print("hi")',
    summary: 'Prints a greeting.',
    logic: { explanation: 'Prints text.', steps: ['Print'], keyComponents: [] },
    issues: [{ id: 'ISSUE-1', title: 'Example', severity: 'LOW', type: 'Readability Issue', line: 1, source: 'static' }],
    quality: { score: 98, grade: 'A', aiScore: 95, counts: {} },
    suggestions: [{ title: 'Add a docstring', description: '', priority: 'low' }],
    improvedCode: 'print("hello")',
    improvements: { changes: [], summary: null },
    complexity: { originalTime: 'O(1)' },
    staticAnalysis: { syntaxValid: true, metrics: { totalLines: 1 } },
    comparison: null,
    finalSummary: 'Fine.',
    ai: { status: 'completed', message: null, provider: 'test', model: 'test-model' },
    ...overrides,
  };
}

test('database opens and passes the health check', async () => {
  const db = await createDatabase({ url: ':memory:' });
  assert.equal(await isDatabaseHealthy(db), true);
  db.close();
  assert.equal(await isDatabaseHealthy(db), false);
});

test('create() stores a review and JSON fields round-trip correctly', async () => {
  const { model, userId } = await setup();
  const saved = await model.create(sampleReview({ userId }));

  assert.equal(saved.id, 1);
  assert.equal(saved.issueCount, 1);
  assert.deepEqual(saved.issues, sampleReview().issues);
  assert.deepEqual(saved.logic.steps, ['Print']);
  assert.equal(saved.quality.score, 98);
  assert.equal(saved.comparison, null);
  assert.deepEqual(saved.ai, { status: 'completed', message: null }); // provider/model are stored but not exposed
  assert.match(saved.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('findAll() returns summaries newest first with paging', async () => {
  const { model, userId } = await setup();
  await model.create(sampleReview({ userId, summary: 'first' }));
  await model.create(sampleReview({ userId, summary: 'second' }));
  await model.create(sampleReview({ userId, summary: 'third' }));

  const page = await model.findAll({ userId, limit: 2, offset: 0 });
  assert.deepEqual(page.map((r) => r.summary), ['third', 'second']);
  assert.equal(page[0].qualityScore, 98);
  assert.equal((await model.findAll({ userId, limit: 2, offset: 2 })).length, 1);
  assert.equal(await model.count(userId), 3);
});

test('deleteById() removes a review and reports missing ids', async () => {
  const { model, userId } = await setup();
  const { id } = await model.create(sampleReview({ userId }));
  assert.equal(await model.deleteById(id, userId), true);
  assert.equal(await model.findById(id, userId), null);
  assert.equal(await model.deleteById(id, userId), false);
});

test('every query is limited to the owner of the review', async () => {
  const { model, userId, otherUserId } = await setup();
  const { id } = await model.create(sampleReview({ userId }));

  assert.equal(await model.findById(id, otherUserId), null);
  assert.equal(await model.findById(id), null, 'no user -> nothing');
  assert.deepEqual(await model.findAll({ userId: otherUserId }), []);
  assert.deepEqual(await model.findAll(), []);
  assert.equal(await model.count(otherUserId), 0);
  assert.equal(await model.deleteById(id, otherUserId), false);
  assert.equal(await model.deleteById(id), false);

  assert.equal((await model.findById(id, userId)).id, id, 'the owner still has the review');
});

test('a database from before user accounts is upgraded without losing its reviews', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cra-db-'));
  const url = pathToFileURL(path.join(dir, 'old.db')).href;
  try {
    // The reviews table as it was before accounts existed (no user_id column).
    const old = createClient({ url });
    await old.execute("CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, language TEXT NOT NULL, original_code TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', logic TEXT NOT NULL DEFAULT '{}', issues TEXT NOT NULL DEFAULT '[]', issue_count INTEGER NOT NULL DEFAULT 0, quality_score INTEGER, suggestions TEXT NOT NULL DEFAULT '[]', improved_code TEXT NOT NULL DEFAULT '', improvement_explanation TEXT NOT NULL DEFAULT '{}', complexity TEXT NOT NULL DEFAULT '{}', static_analysis TEXT NOT NULL DEFAULT '{}', comparison TEXT, final_summary TEXT NOT NULL DEFAULT '', quality TEXT NOT NULL DEFAULT '{}', ai_status TEXT NOT NULL DEFAULT 'completed', ai_message TEXT, ai_provider TEXT, ai_model TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))");
    await old.execute("INSERT INTO reviews (language, original_code) VALUES ('python', 'print(1)')");
    old.close();

    const db = await createDatabase({ url });
    const columns = (await db.execute('PRAGMA table_info(reviews)')).rows.map((column) => column.name);
    assert.ok(columns.includes('user_id'));
    const { rows } = await db.execute('SELECT original_code, user_id FROM reviews');
    assert.equal(rows.length, 1, 'the old review is kept');
    assert.equal(rows[0].user_id, null, 'it has no owner, so no user can see it');
    for (const table of ['users', 'sessions', 'user_ai_usage', 'ai_usage_logs']) {
      assert.equal((await db.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n, 0, table);
    }
    db.close();

    (await createDatabase({ url })).close(); // opening it again changes nothing
  } finally {
    // Best effort: Windows may keep the database file locked for a moment.
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch { /* the temporary folder is removed by the system later */ }
  }
});
