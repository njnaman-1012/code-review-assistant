import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviderChain } from '../services/ai/providers/resolveProviderChain.js';
import { createAiReviewService } from '../services/aiReviewService.js';
import { stripLineNumbers } from '../services/ai/aiResponseValidator.js';
import { AiServiceError } from '../utils/AppError.js';
import { createTestProvider, validAiReview, PYTHON_CODE } from './helpers.js';
import { analyzeCode } from '../services/staticAnalysis/index.js';

const names = (env) => resolveProviderChain(env).providers.map((p) => p.name);

describe('Provider chain configuration', () => {
  test('auto mode works with no keys at all (free keyless providers)', () => {
    assert.deepEqual(names({}), ['ovh', 'llm7']);
    assert.deepEqual(names({ AI_PROVIDER: 'auto' }), ['ovh', 'llm7']);
    const [ovh] = resolveProviderChain({}).providers;
    assert.equal(ovh.omitAuthWithoutKey, true);
    assert.ok(ovh.timeoutMs > 120000, 'slow free provider gets a longer timeout');
  });

  test('auto mode puts free keyed providers first when their keys are set', () => {
    assert.deepEqual(names({ GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' }), ['gemini', 'groq', 'ovh', 'llm7']);
    const [gemini] = resolveProviderChain({ GEMINI_API_KEY: 'g' }).providers;
    assert.equal(gemini.model, 'gemini-3.8-flash');
    assert.match(gemini.baseUrl, /generativelanguage\.googleapis\.com/);
  });

  test('auto mode never picks a paid provider', () => {
    assert.ok(!names({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' }).includes('anthropic'));
  });

  test('an explicit list is used in the given order and skips providers without keys', () => {
    const { providers, skipped } = resolveProviderChain({ AI_PROVIDER: 'groq, gemini, llm7', GEMINI_API_KEY: 'g' });
    assert.deepEqual(providers.map((p) => p.name), ['gemini', 'llm7']);
    assert.equal(skipped[0].name, 'groq');
  });

  test('a single provider accepts the generic AI_API_KEY / AI_MODEL', () => {
    const [provider] = resolveProviderChain({ AI_PROVIDER: 'anthropic', AI_API_KEY: 'k', AI_MODEL: 'claude-sonnet-5' }).providers;
    assert.equal(provider.kind, 'anthropic');
    assert.equal(provider.model, 'claude-sonnet-5');
  });

  test('model can be overridden per provider and AI can be turned off', () => {
    const llm7 = resolveProviderChain({ LLM7_MODEL: 'minimax-m2.7' }).providers.find((p) => p.name === 'llm7');
    assert.equal(llm7.model, 'minimax-m2.7');
    assert.deepEqual(names({ AI_PROVIDER: 'none' }), []);
  });

  test('an unknown provider name is a configuration error', () => {
    assert.throws(() => resolveProviderChain({ AI_PROVIDER: 'skynet' }), /Unknown AI provider/);
  });
});

describe('Provider fallback', () => {
  const input = async () => ({ language: 'python', code: PYTHON_CODE, staticResult: await analyzeCode(PYTHON_CODE, 'python') });

  test('uses the next provider when the first one is rate-limited', async () => {
    const first = { ...createTestProvider(new AiServiceError('AI_RATE_LIMITED', 'rate limit reached.')), name: 'gemini', label: 'Gemini' };
    const second = { ...createTestProvider(validAiReview()), name: 'llm7', label: 'LLM7' };
    const service = createAiReviewService([first, second]);
    const result = await service.reviewCode(await input());
    assert.equal(result.provider, 'LLM7');
    assert.deepEqual(result.failedProviders, ['Gemini: rate limit reached.']);
  });

  test('reports every failure when all providers fail', async () => {
    const service = createAiReviewService([
      { ...createTestProvider(new AiServiceError('AI_TIMEOUT', 'took too long.')), name: 'a', label: 'A' },
      { ...createTestProvider('not json'), name: 'b', label: 'B' },
    ]);
    await assert.rejects(service.reviewCode(await input()), (error) => {
      assert.match(error.message, /All AI providers failed - A: took too long\. \| B: /);
      return true;
    });
  });
});

test('stripLineNumbers removes copied "12 | " prefixes only when every line has one', () => {
  assert.equal(stripLineNumbers(' 9 | x = 1\n10 | y = 2'), 'x = 1\ny = 2');
  assert.equal(stripLineNumbers('x = a | b\ny = 2'), 'x = a | b\ny = 2');
});
