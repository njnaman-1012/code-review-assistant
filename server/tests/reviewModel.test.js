import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, isDatabaseHealthy } from '../database/db.js';
import { createReviewModel } from '../models/reviewModel.js';

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
  const model = createReviewModel(await createDatabase({ url: ':memory:' }));
  const saved = await model.create(sampleReview());

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
  const model = createReviewModel(await createDatabase({ url: ':memory:' }));
  await model.create(sampleReview({ summary: 'first' }));
  await model.create(sampleReview({ summary: 'second' }));
  await model.create(sampleReview({ summary: 'third' }));

  const page = await model.findAll({ limit: 2, offset: 0 });
  assert.deepEqual(page.map((r) => r.summary), ['third', 'second']);
  assert.equal(page[0].qualityScore, 98);
  assert.equal((await model.findAll({ limit: 2, offset: 2 })).length, 1);
  assert.equal(await model.count(), 3);
});

test('deleteById() removes a review and reports missing ids', async () => {
  const model = createReviewModel(await createDatabase({ url: ':memory:' }));
  const { id } = await model.create(sampleReview());
  assert.equal(await model.deleteById(id), true);
  assert.equal(await model.findById(id), null);
  assert.equal(await model.deleteById(id), false);
});
