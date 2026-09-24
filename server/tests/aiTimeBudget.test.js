// The AI time budget keeps every request inside the hosting limit
// (Vercel stops a request after 300 s, so the AI gets 240 s there).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createAiReviewService } from '../services/aiReviewService.js';
import { AiServiceError } from '../utils/AppError.js';
import { createTestProvider, validAiReview, PYTHON_CODE } from './helpers.js';
import { analyzeCode } from '../services/staticAnalysis/index.js';

describe('AI time budget', () => {
  test('each AI request gets at most the time left in the budget', async () => {
    const provider = createTestProvider(validAiReview());
    const service = createAiReviewService(provider);
    const staticResult = await analyzeCode(PYTHON_CODE, 'python');
    await service.reviewCode({ language: 'python', code: PYTHON_CODE, staticResult, deadline: Date.now() + 60_000 });
    const [call] = provider.calls;
    assert.ok(call.timeLeftMs > 50_000 && call.timeLeftMs <= 60_000, `timeLeftMs was ${call.timeLeftMs}`);
  });

  test('without a budget, requests use the provider timeout', async () => {
    const provider = createTestProvider(validAiReview());
    const staticResult = await analyzeCode(PYTHON_CODE, 'python');
    await createAiReviewService(provider).reviewCode({ language: 'python', code: PYTHON_CODE, staticResult });
    assert.equal(provider.calls[0].timeLeftMs, undefined);
  });

  test('no new AI request is started when the budget is used up', async () => {
    const provider = createTestProvider(validAiReview());
    const staticResult = await analyzeCode(PYTHON_CODE, 'python');
    await assert.rejects(
      createAiReviewService(provider).reviewCode({ language: 'python', code: PYTHON_CODE, staticResult, deadline: Date.now() + 5_000 }),
      (error) => error instanceof AiServiceError && error.code === 'AI_TIMEOUT',
    );
    assert.equal(provider.calls.length, 0);
  });
});
