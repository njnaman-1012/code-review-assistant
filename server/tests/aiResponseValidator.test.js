import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAiReview, parseAiJson, stripCodeFences } from '../services/ai/aiResponseValidator.js';
import { AiServiceError } from '../utils/AppError.js';
import { validAiReview } from './helpers.js';

test('accepts a valid AI review (object or JSON string)', () => {
  assert.equal(validateAiReview(validAiReview()).summary, 'Computes the average of a list of numbers.');
  assert.equal(validateAiReview(JSON.stringify(validAiReview())).issues.length, 1);
});

test('extracts JSON wrapped in markdown fences or extra text', () => {
  const raw = `Here is the review:\n\`\`\`json\n${JSON.stringify(validAiReview())}\n\`\`\``;
  assert.equal(validateAiReview(raw).qualityScore, 62);
});

test('rejects text that is not JSON', () => {
  assert.throws(() => parseAiJson('I cannot review this.'), AiServiceError);
  assert.throws(() => validateAiReview('{ broken json'), (error) => error.code === 'AI_INVALID_RESPONSE');
});

test('rejects a response missing required content', () => {
  assert.throws(() => validateAiReview(validAiReview({ summary: '' })), /summary/);
  assert.throws(() => validateAiReview([1, 2, 3]), AiServiceError);
});

test('normalizes severity, type, line and confidence variations', () => {
  const review = validateAiReview(validAiReview({
    issues: [{
      title: 'X', type: 'performance', severity: 'major', line: 'line 12', code: '',
      explanation: 'slow', impact: '', suggestion: '', confidence: 'HIGH',
    }],
  }));
  const [issue] = review.issues;
  assert.equal(issue.type, 'Performance Issue');
  assert.equal(issue.severity, 'HIGH');
  assert.equal(issue.line, 12);
  assert.equal(issue.confidence, 'likely'); // unknown value -> safe default
});

test('clamps the quality score and fills missing optional fields', () => {
  const review = validateAiReview(validAiReview({ qualityScore: 140, suggestions: ['Add tests'], logicSteps: undefined, complexity: {} }));
  assert.equal(review.qualityScore, 100);
  assert.deepEqual(review.suggestions[0], { title: 'Add tests', description: '', priority: 'medium' });
  assert.deepEqual(review.logicSteps, []);
  assert.equal(review.complexity.originalTime, 'Not determined');
});

test('removes markdown code fences around improved code', () => {
  assert.equal(stripCodeFences('```python\nprint(1)\n```'), 'print(1)');
  assert.equal(stripCodeFences('print(1)'), 'print(1)');
});
