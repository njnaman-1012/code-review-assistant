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

test('database opens and passes the health check', () => {
  const db = createDatabase(':memory:');
  assert.equal(isDatabaseHealthy(db), true);
  db.close();
  assert.equal(isDatabaseHealthy(db), false);
});

test('create() stores a review and JSON fields round-trip correctly', () => {
  const model = createReviewModel(createDatabase(':memory:'));
  const saved = model.create(sampleReview());

  assert.equal(saved.id, 1);
  assert.equal(saved.issueCount, 1);
  assert.deepEqual(saved.issues, sampleReview().issues);
  assert.deepEqual(saved.logic.steps, ['Print']);
  assert.equal(saved.quality.score, 98);
  assert.equal(saved.comparison, null);
  assert.deepEqual(saved.ai, { status: 'completed', message: null }); // provider/model are stored but not exposed
  assert.match(saved.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('findAll() returns summaries newest first with paging', () => {
  const model = createReviewModel(createDatabase(':memory:'));
  model.create(sampleReview({ summary: 'first' }));
  model.create(sampleReview({ summary: 'second' }));
  model.create(sampleReview({ summary: 'third' }));

  const page = model.findAll({ limit: 2, offset: 0 });
  assert.deepEqual(page.map((r) => r.summary), ['third', 'second']);
  assert.equal(page[0].qualityScore, 98);
  assert.equal(model.findAll({ limit: 2, offset: 2 }).length, 1);
  assert.equal(model.count(), 3);
});

test('deleteById() removes a review and reports missing ids', () => {
  const model = createReviewModel(createDatabase(':memory:'));
  const { id } = model.create(sampleReview());
  assert.equal(model.deleteById(id), true);
  assert.equal(model.findById(id), null);
  assert.equal(model.deleteById(id), false);
});
