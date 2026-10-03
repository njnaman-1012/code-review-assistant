import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { resolveProviderChain } from '../services/ai/providers/resolveProviderChain.js';
import { createOpenAiCompatibleProvider } from '../services/ai/providers/openaiCompatibleProvider.js';
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

describe('Model fallback inside one provider', () => {
  // A small stand-in for an OpenAI-compatible AI service: `answer(model)` returns
  // an HTTP status (200 sends a normal completion), or { status, delayMs } to answer late.
  async function fakeAiService(answer) {
    const requested = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const { model } = JSON.parse(body);
        requested.push(model);
        const answered = answer(model);
        const { status, delayMs = 0 } = typeof answered === 'number' ? { status: answered } : answered;
        setTimeout(() => {
          if (res.destroyed) return; // the client gave up waiting
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(status === 200
            ? { model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }], usage: { total_tokens: 12 } }
            : { error: { code: status, message: 'This model is currently experiencing high demand.' } }));
        }, delayMs);
      });
    });
    await new Promise((resolve) => { server.listen(0, resolve); });
    const provider = (options) => createOpenAiCompatibleProvider({
      name: 'gemini', label: 'Gemini', apiKey: 'k', baseUrl: `http://localhost:${server.address().port}`, timeoutMs: 5000, ...options,
    });
    return { requested, provider, close: () => { server.closeAllConnections(); server.close(); } };
  }
  const ask = (provider) => provider.generateJson({ system: 's', prompt: 'p', shapeHint: 'h', timeLeftMs: 30_000 });

  test('the next model answers when the default model is overloaded (HTTP 503) or rate-limited (429)', async () => {
    const service = await fakeAiService((model) => ({ 'busy-model': 503, 'limited-model': 429 }[model] ?? 200));
    try {
      const provider = service.provider({ model: 'busy-model', fallbackModels: ['limited-model', 'free-model', 'unused-model'] });
      const result = await ask(provider);
      assert.equal(result.text, '{"ok":true}');
      assert.equal(result.model, 'free-model');
      assert.deepEqual(result.usage, { totalTokens: 12 });
      assert.deepEqual(service.requested, ['busy-model', 'limited-model', 'free-model']);
    } finally {
      service.close();
    }
  });

  test('when every model is overloaded the provider fails, so the next provider is tried', async () => {
    const service = await fakeAiService(() => 503);
    try {
      const provider = service.provider({ model: 'a', fallbackModels: ['b'] });
      await assert.rejects(ask(provider), (error) => error instanceof AiServiceError && error.code === 'AI_UNAVAILABLE');
      assert.deepEqual(service.requested, ['a', 'b']);
    } finally {
      service.close();
    }
  });

  test('a model that hangs is given up after its time limit and the next model answers', async () => {
    const service = await fakeAiService((model) => (model === 'hanging-model' ? { status: 200, delayMs: 5000 } : 200));
    try {
      const provider = service.provider({ model: 'hanging-model', fallbackModels: ['fast-model'], modelTimeoutMs: 300 });
      const started = Date.now();
      const result = await ask(provider);
      assert.equal(result.model, 'fast-model');
      assert.deepEqual(service.requested, ['hanging-model', 'fast-model']);
      assert.ok(Date.now() - started < 2500, 'did not wait for the hanging model');
    } finally {
      service.close();
    }
  });

  test('the last model (and a provider without fallback models) keeps the full time limit', async () => {
    const service = await fakeAiService(() => ({ status: 200, delayMs: 700 }));
    try {
      // 700 ms is longer than the model limit, but there is nothing left to switch to.
      assert.equal((await ask(service.provider({ model: 'only-model', modelTimeoutMs: 300 }))).model, 'only-model');
      const result = await ask(service.provider({ model: 'slow-a', fallbackModels: ['slow-b'], modelTimeoutMs: 300 }));
      assert.equal(result.model, 'slow-b');
      assert.deepEqual(service.requested, ['only-model', 'slow-a', 'slow-b']);
    } finally {
      service.close();
    }
  });

  test('a rejected API key is not retried with other models', async () => {
    const service = await fakeAiService(() => 401);
    try {
      const provider = service.provider({ model: 'a', fallbackModels: ['b', 'c'] });
      await assert.rejects(ask(provider), (error) => error.code === 'AI_AUTH_FAILED');
      assert.deepEqual(service.requested, ['a']);
    } finally {
      service.close();
    }
  });

  test('Gemini has fallback models by default; they can be changed or turned off', () => {
    const gemini = (env) => resolveProviderChain({ GEMINI_API_KEY: 'g', ...env }).providers[0];
    assert.ok(gemini({}).fallbackModels.length >= 2);
    assert.ok(!gemini({}).fallbackModels.includes(gemini({}).model));
    assert.deepEqual(gemini({ GEMINI_FALLBACK_MODELS: 'x-model, y-model' }).fallbackModels, ['x-model', 'y-model']);
    assert.deepEqual(gemini({ GEMINI_FALLBACK_MODELS: 'none' }).fallbackModels, []);
    assert.ok(!gemini({ GEMINI_MODEL: 'gemini-3.5-flash' }).fallbackModels.includes('gemini-3.5-flash'));
    assert.deepEqual(resolveProviderChain({}).providers[0].fallbackModels, [], 'providers without fallback models are unchanged');
    assert.ok(gemini({}).modelTimeoutMs >= 30000, 'each Gemini model has a time limit');
    assert.equal(gemini({ AI_MODEL_TIMEOUT_MS: '20000' }).modelTimeoutMs, 20000);
    assert.equal(resolveProviderChain({}).providers[0].modelTimeoutMs, undefined);
  });
});
