// Shared test setup: an app with an in-memory database and a *test double*
// AI provider, so tests are fast, free and never call a real AI service.
import request from 'supertest';
import { createDatabase } from '../database/db.js';
import { createApp } from '../app.js';
import { createAiReviewService } from '../services/aiReviewService.js';

process.env.NODE_ENV = 'test'; // silences the logger

export const testConfig = {
  clientOrigins: ['http://localhost:5173'],
  limits: { maxCodeChars: 20000, maxCodeLines: 800, jsonBodyLimit: '200kb' },
  rateLimit: { windowMs: 60_000, maxRequests: 10_000, maxReviews: 10_000, maxAuthAttempts: 10_000, maxOtpRequests: 10_000 },
  auth: {
    sessionTtlMs: 60 * 60 * 1000,
    cookieSecure: false,
    secret: 'test-secret',
    otp: { ttlMs: 10 * 60 * 1000, maxAttempts: 5, resendCooldownMs: 60_000, maxPerHour: 5 },
    login: { maxFailures: 10, lockMs: 15 * 60 * 1000 },
  },
  usage: { defaultUserTokens: 100_000 },
};

export const TEST_PASSWORD = 'Passw0rd123';

export const PYTHON_CODE = 'import os\n\ndef average(values=[]):\n    total = 0\n    for v in values:\n        total += v\n    return total / len(values)\n';

// A complete, valid AI answer for PYTHON_CODE.
export function validAiReview(overrides = {}) {
  return {
    summary: 'Computes the average of a list of numbers.',
    logicExplanation: 'The function adds every value and divides by the number of values.',
    logicSteps: ['First, total is set to 0.', 'Then each value is added.', 'Finally the total is divided by the count.'],
    keyComponents: [{ name: 'average', kind: 'function', description: 'Returns the mean of the values.' }],
    issues: [{
      title: 'Division by zero for an empty list',
      type: 'Runtime Risk',
      severity: 'HIGH',
      line: 7,
      code: 'return total / len(values)',
      explanation: 'len(values) is 0 when the list is empty.',
      impact: 'ZeroDivisionError at runtime.',
      suggestion: 'Return 0 or raise ValueError when the list is empty.',
      confidence: 'confirmed',
    }],
    qualityScore: 62,
    suggestions: [{ title: 'Handle empty input', description: 'Check for an empty list first.', priority: 'high' }],
    improvedCode: 'def average(values=None):\n    if not values:\n        raise ValueError("values must not be empty")\n    return sum(values) / len(values)\n',
    improvementExplanation: [{
      change: 'Removed the mutable default argument',
      original: 'values=[]',
      improved: 'values=None',
      reason: 'Default lists are shared between calls.',
      benefit: 'Each call gets independent data.',
    }],
    improvementSummary: { performance: 'No change.', readability: 'Improved.', complexity: 'No change.', security: 'No change.' },
    complexity: { originalTime: 'O(n)', originalSpace: 'O(1)', improvedTime: 'O(n)', improvedSpace: 'O(1)', explanation: 'One pass over the list.' },
    finalSummary: 'Small function with an empty-list bug and a mutable default argument.',
    ...overrides,
  };
}

// Test double for an AI provider. `responses` can be an object, a string,
// an Error, or a function (callNumber) => one of those.
export function createTestProvider(responses) {
  const provider = {
    name: 'test-provider',
    model: 'test-model',
    calls: [],
    async generateJson(args) {
      provider.calls.push(args);
      const next = typeof responses === 'function' ? responses(provider.calls.length) : responses;
      if (next instanceof Error) throw next;
      return { text: typeof next === 'string' ? next : JSON.stringify(next), model: 'test-model', usage: provider.usage };
    },
  };
  return provider;
}

// Test double that answers per AI operation ("review", "correct", "improve").
// Each handler is a value like in createTestProvider, or a function
// (callNumberForThatOperation, args) => value (a Promise is awaited).
export function createRoutingProvider(handlers) {
  const counts = {};
  const provider = {
    name: 'test-provider',
    model: 'test-model',
    calls: [],
    callsFor: (operation) => provider.calls.filter((call) => call.operation === operation),
    async generateJson(args) {
      provider.calls.push(args);
      counts[args.operation] = (counts[args.operation] ?? 0) + 1;
      const handler = handlers[args.operation];
      const next = await (typeof handler === 'function' ? handler(counts[args.operation], args) : handler);
      if (next instanceof Error) throw next;
      return { text: typeof next === 'string' ? next : JSON.stringify(next), model: 'test-model', usage: provider.usage };
    },
  };
  return provider;
}

// Test double for the e-mail service: nothing is sent, the messages are kept in `outbox`.
export function createTestEmailService() {
  const service = {
    outbox: [],
    failing: false, // set to true to simulate an e-mail provider that is down
    isConfigured: () => true,
    async send(message) {
      if (service.failing) throw new Error('provider down');
      service.outbox.push(message);
    },
  };
  return service;
}

// The 6-digit code of the newest e-mail to an address (as the user would read it).
export function lastCode(outbox, email) {
  const message = outbox.filter((mail) => mail.to === email.trim().toLowerCase()).at(-1);
  return message?.text.match(/\b(\d{6})\b/)?.[1] ?? null;
}

// Registers a new user, verifies the e-mail address with the code from the
// outbox and returns a supertest agent that stays logged in (it keeps the
// cookies, like a browser).
let userCounter = 0;
export async function registerUser(app, email, outbox = app.locals.outbox) {
  userCounter += 1;
  const address = email ?? `student${userCounter}@example.com`;
  const agent = request.agent(app);
  const registered = await agent.post('/api/auth/register').send({ email: address, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
  if (registered.status !== 201) throw new Error(`test user could not be registered: ${JSON.stringify(registered.body)}`);
  const res = await agent.post('/api/auth/verify-email').send({ otp: lastCode(outbox, address) });
  if (res.status !== 200) throw new Error(`test user could not be verified: ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.data.user, usage: res.body.data.usage };
}

// Removes the counters (cooldowns, attempt limits), as if the time windows were over.
export const clearRateLimits = (db) => db.execute('DELETE FROM rate_limits');

// `agent` is a logged-in, verified user; `app` is the bare application (no login);
// `outbox` holds the e-mails the application "sent".
// register: false skips the default user (for tests of the bare application).
export async function createTestApp({ provider = null, config = {}, register = true } = {}) {
  const db = await createDatabase({ url: ':memory:' });
  const aiReviewService = createAiReviewService(provider);
  const emailService = createTestEmailService();
  const app = createApp({ db, aiReviewService, emailService, config: { ...testConfig, ...config, auth: { ...testConfig.auth, ...config.auth } } });
  app.locals.outbox = emailService.outbox;
  const { agent, user } = register ? await registerUser(app) : {};
  return { app, db, agent, user, outbox: emailService.outbox, emailService };
}
