// Security tests: SQL injection, cross-site scripting, security headers, CORS,
// rate limits kept in the database, request size, error messages and the audit log.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';
import { createAiReviewService } from '../services/aiReviewService.js';
import {
  createTestApp, createTestProvider, createTestEmailService, registerUser, lastCode, clearRateLimits, testConfig,
  validAiReview, PYTHON_CODE, TEST_PASSWORD,
} from './helpers.js';

const SQL_PAYLOADS = ["'", '"', "' OR '1'='1", "' OR 1=1 --", "'; DROP TABLE users; --", "admin'--", "1; DROP TABLE reviews", "' UNION SELECT password_hash FROM users --"];
const count = async (db, table) => (await db.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n;

describe('SQL injection', () => {
  test('login: injection text is treated as data and never logs anybody in', async () => {
    const { app, db, user } = await createTestApp();
    for (const payload of SQL_PAYLOADS) {
      const attempts = [
        { email: payload, password: payload },
        { email: `${user.email}${payload}`, password: TEST_PASSWORD },
        { email: user.email, password: payload },
        { email: `${payload}@example.com`, password: TEST_PASSWORD },
      ];
      for (const body of attempts) {
        const res = await request(app).post('/api/auth/login').send(body);
        assert.ok([400, 401].includes(res.status), `${JSON.stringify(body)} -> ${res.status}`);
        assert.equal(res.headers['set-cookie'], undefined);
        assert.ok(!/sql|syntax|sqlite/i.test(JSON.stringify(res.body)), 'no database error leaks out');
      }
      await clearRateLimits(db);
    }
    assert.equal(await count(db, 'users'), 1, 'the users table is intact');
    assert.equal((await request(app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status, 200);
  });

  test('registration and password reset: injection text is rejected or stored as plain text', async () => {
    const { app, db, outbox, user: firstUser } = await createTestApp();
    for (const payload of SQL_PAYLOADS) {
      for (const path of ['/api/auth/register', '/api/auth/forgot-password']) {
        const res = await request(app).post(path).send({ email: `x${payload}@example.com`, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
        // Refused as an invalid address - or, where the characters are legal in an
        // e-mail address (an apostrophe is), handled like any other address.
        assert.ok([200, 201, 400].includes(res.status), `${path} ${payload} -> ${res.status}`);
        assert.ok(!/sql|syntax|sqlite/i.test(JSON.stringify(res.body)), 'no database error leaks out');
        await clearRateLimits(db);
      }
    }

    // A real address with an apostrophe works from registration to login.
    const { agent, user } = await registerUser(app, "o'brien@example.com");
    assert.equal(user.email, "o'brien@example.com");
    assert.equal((await agent.get('/api/auth/me')).body.data.user.email, "o'brien@example.com");
    assert.equal((await request(app).post('/api/auth/login').send({ email: "o'brien@example.com", password: TEST_PASSWORD })).status, 200);
    assert.match(lastCode(outbox, "o'brien@example.com"), /^\d{6}$/);

    // A password made of SQL is just a password.
    await clearRateLimits(db);
    const sqlPassword = "pass1' OR '1'='1";
    const pending = request.agent(app);
    await pending.post('/api/auth/register').send({ email: 'sqlpass@example.com', password: sqlPassword, confirmPassword: sqlPassword });
    await pending.post('/api/auth/verify-email').send({ otp: lastCode(outbox, 'sqlpass@example.com') });
    assert.equal((await request(app).post('/api/auth/login').send({ email: 'sqlpass@example.com', password: "' OR '1'='1" })).status, 401);
    assert.equal((await request(app).post('/api/auth/login').send({ email: 'sqlpass@example.com', password: sqlPassword })).status, 200);
    for (const table of ['users', 'sessions', 'user_ai_usage', 'reviews', 'email_verification_codes']) assert.ok(await count(db, table) >= 0, `${table} still exists`);
    const verified = (await db.execute('SELECT email FROM users WHERE email_verified = 1 ORDER BY id')).rows.map((row) => row.email);
    assert.deepEqual(verified, [firstUser.email, "o'brien@example.com", 'sqlpass@example.com'], 'no account was activated by an injection');
  });

  test('review IDs, paging values, report formats and submitted code cannot change a query', async () => {
    const { app, agent, db } = await createTestApp({ provider: createTestProvider(validAiReview()) });
    const { agent: other } = await registerUser(app, 'other@example.com');
    const mine = (await agent.post('/api/reviews').send({ language: 'python', code: PYTHON_CODE })).body.data;
    await other.post('/api/reviews').send({ language: 'python', code: 'secret_of_other = 1\n' });

    for (const payload of ['1 OR 1=1', '1;DROP TABLE reviews', "1' OR '1'='1", '1 UNION SELECT * FROM users', '0x1', '1e0', '-1', '1.5']) {
      const id = encodeURIComponent(payload);
      for (const res of [
        await agent.get(`/api/reviews/${id}`),
        await agent.delete(`/api/reviews/${id}`),
        await agent.get(`/api/reviews/${id}/report`),
        await agent.post(`/api/reviews/${id}/correct`).send({}),
      ]) {
        assert.equal(res.status, 400, payload);
        assert.equal(res.body.error.code, 'INVALID_ID');
      }
    }

    // Paging values are turned into numbers; injected text has no effect and shows nobody else's rows.
    const listed = await agent.get('/api/reviews').query({ limit: '100; DROP TABLE reviews', offset: "0' OR '1'='1", userId: '1 OR 1=1', sort: 'id; DELETE FROM users' });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.total, 1);
    assert.ok(!JSON.stringify(listed.body).includes('secret_of_other'));
    assert.equal((await agent.get(`/api/reviews/${mine.id}/report`).query({ format: "html' OR '1'='1" })).status, 400);

    // SQL inside the submitted code is stored and returned exactly as typed.
    const code = "name = \"x'; DROP TABLE reviews; --\"\nquery = \"SELECT * FROM users WHERE '1'='1'\"\n";
    const created = await agent.post('/api/reviews').send({ language: 'python', code });
    assert.equal(created.status, 201);
    assert.equal((await agent.get(`/api/reviews/${created.body.data.id}`)).body.data.originalCode, code);

    assert.equal(await count(db, 'reviews'), 3, 'no review was deleted or added by an injection');
    assert.equal(await count(db, 'users'), 2);
    assert.equal((await other.get('/api/reviews')).body.data.total, 1);
  });
});

describe('Cross-site scripting (XSS)', () => {
  const SCRIPT = "<script>alert('XSS')</script>";
  const IMAGE = '<img src=x onerror=alert(1)>';

  test('script text in code or in an AI answer is data: JSON from the API, escaped in the HTML report', async () => {
    const provider = createTestProvider(validAiReview({
      summary: `Summary ${SCRIPT}`,
      logicExplanation: `Explanation ${IMAGE}`,
      finalSummary: `Final ${SCRIPT}`,
      suggestions: [{ title: `Title ${IMAGE}`, description: `Description ${SCRIPT}`, priority: 'high' }],
    }));
    const { agent } = await createTestApp({ provider });
    const code = `console.log("${SCRIPT}"); // ${IMAGE}\n`;
    const created = await agent.post('/api/reviews').send({ language: 'javascript', code });
    assert.equal(created.status, 201);

    // The API answers with JSON that browsers must not interpret as a page.
    for (const res of [created, await agent.get(`/api/reviews/${created.body.data.id}`), await agent.get('/api/reviews')]) {
      assert.match(res.headers['content-type'], /^application\/json/);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    }
    assert.equal(created.body.data.originalCode, code, 'stored exactly as typed');

    // The HTML report is a page: everything from the user and from the AI is escaped.
    const html = await agent.get(`/api/reviews/${created.body.data.id}/report?format=html`);
    assert.match(html.headers['content-disposition'], /^attachment/);
    assert.ok(!html.text.includes("<script>alert('XSS')</script>"), 'no executable script from user or AI text');
    assert.ok(!html.text.includes('<img src=x'), 'no injected element');
    assert.ok(html.text.includes('&lt;script&gt;alert(&#39;XSS&#39;)&lt;/script&gt;') || html.text.includes('&lt;script&gt;alert(&#x27;XSS&#x27;)&lt;/script&gt;'));
    assert.ok(html.text.includes('&lt;img src=x onerror=alert(1)&gt;'));

    // The Markdown report is a download, not a page.
    const md = await agent.get(`/api/reviews/${created.body.data.id}/report?format=md`);
    assert.match(md.headers['content-type'], /^text\/markdown/);
    assert.match(md.headers['content-disposition'], /^attachment/);
  });

  test('error messages that repeat user input are JSON, never HTML', async () => {
    const { app, agent } = await createTestApp();
    const responses = [
      await agent.post('/api/reviews').send({ language: SCRIPT, code: 'x = 1' }),
      await agent.get(`/api/${encodeURIComponent(SCRIPT)}`),
      await request(app).post('/api/auth/register').send({ email: `${SCRIPT}@example.com`, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD }),
      await request(app).post('/api/auth/login').send({ email: `"><svg onload=alert(1)>@example.com`, password: TEST_PASSWORD }),
    ];
    for (const res of responses) {
      assert.ok(res.status >= 400 && res.status < 500);
      assert.match(res.headers['content-type'], /^application\/json/);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    }
  });
});

describe('Security headers and CORS', () => {
  test('every response carries the security headers', async () => {
    const { app, agent } = await createTestApp();
    for (const res of [await request(app).get('/api/health'), await agent.get('/api/reviews'), await request(app).get('/api/nothing')]) {
      const csp = res.headers['content-security-policy'];
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self'/);
      assert.match(csp, /object-src 'none'/);
      assert.match(csp, /frame-ancestors 'self'/);
      assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'inline scripts are not allowed');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
      assert.equal(res.headers['referrer-policy'], 'no-referrer');
      assert.match(res.headers['strict-transport-security'], /max-age=\d+/);
      assert.match(res.headers['permissions-policy'], /camera=\(\)/);
      assert.equal(res.headers['x-powered-by'], undefined);
    }
    assert.equal((await agent.get('/api/auth/me')).headers['cache-control'], 'no-store', 'personal data is not cached');
  });

  test('CORS allows only the configured front-end origin, never "*"', async () => {
    const { app } = await createTestApp({ register: false, config: { clientOrigins: ['https://app.example.com'] } });
    const allowed = await request(app).get('/api/health').set('Origin', 'https://app.example.com');
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://app.example.com');
    const foreign = await request(app).get('/api/health').set('Origin', 'https://evil.example.net');
    assert.equal(foreign.headers['access-control-allow-origin'], undefined);
    const preflight = await request(app).options('/api/reviews').set('Origin', 'https://evil.example.net').set('Access-Control-Request-Method', 'POST');
    assert.equal(preflight.headers['access-control-allow-origin'], undefined);
    assert.equal(preflight.headers['access-control-allow-credentials'], undefined);
  });
});

describe('Rate limiting', () => {
  // A second server instance on the same database (as on a serverless host).
  const secondInstance = (db, config) => createApp({
    db, aiReviewService: createAiReviewService(null), emailService: createTestEmailService(), config: { ...testConfig, ...config },
  });

  test('login and registration attempts are limited per address, across server instances', async () => {
    const config = { rateLimit: { ...testConfig.rateLimit, maxAuthAttempts: 3 } };
    const { app, db } = await createTestApp({ register: false, config });
    const attempt = (target) => request(target).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'Whatever123' });

    for (let i = 1; i <= 3; i += 1) assert.equal((await attempt(app)).status, 401);
    const limited = await attempt(app);
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'RATE_LIMITED');
    assert.ok(limited.headers['retry-after'] || limited.headers.ratelimit, 'tells the client when to retry');

    // The counter is in the database, so a new instance does not start at zero.
    assert.equal((await attempt(secondInstance(db, config))).status, 429);
    assert.equal((await request(app).post('/api/auth/register').send({ email: 'a@example.com', password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD })).status, 429);
    assert.equal((await request(app).post('/api/auth/forgot-password').send({ email: 'a@example.com' })).status, 429);
    const { rows } = await db.execute("SELECT key, hits FROM rate_limits WHERE key LIKE 'auth:%'");
    assert.equal(rows.length, 1);
    assert.ok(rows[0].hits >= 4);
    assert.ok(!rows[0].key.includes('127.0.0.1'), 'the address is stored as a hash');
  });

  test('entering codes is limited per address', async () => {
    const { app, outbox } = await createTestApp({ config: { rateLimit: { ...testConfig.rateLimit, maxOtpRequests: 3 } } });
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email: 'slow@example.com', password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD });
    const code = lastCode(outbox, 'slow@example.com');
    const wrong = code === '123456' ? '654321' : '123456';
    // The default user of createTestApp already entered one code from this address.
    for (let i = 1; i <= 2; i += 1) assert.equal((await agent.post('/api/auth/verify-email').send({ otp: wrong })).status, 400);
    const limited = await agent.post('/api/auth/verify-email').send({ otp: code });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'RATE_LIMITED');
  });

  test('AI requests are limited per user, not per network address', async () => {
    const provider = createTestProvider(validAiReview());
    const { app, agent: alice } = await createTestApp({ provider, config: { rateLimit: { ...testConfig.rateLimit, maxReviews: 2, maxCodeActions: 1 } } });
    const { agent: bob } = await registerUser(app, 'bob@example.com');
    const review = (target) => target.post('/api/reviews').send({ language: 'python', code: PYTHON_CODE });

    const first = await review(alice);
    assert.equal(first.status, 201);
    assert.equal((await review(alice)).status, 201);
    const limited = await review(alice);
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'RATE_LIMITED');
    assert.equal(provider.calls.length, 2, 'the AI was not called for the refused request');

    // Bob uses the same network address and is not affected.
    assert.equal((await review(bob)).status, 201);

    // "Fix" and "Improve" share one limit per user.
    await alice.post(`/api/reviews/${first.body.data.id}/correct`).send({});
    assert.equal((await alice.post(`/api/reviews/${first.body.data.id}/improve`).send({})).status, 429);
  });
});

describe('Requests and errors', () => {
  test('oversized requests are refused', async () => {
    const { app, agent } = await createTestApp();
    const huge = 'x'.repeat(300 * 1024);
    const review = await agent.post('/api/reviews').send({ language: 'python', code: huge });
    assert.equal(review.status, 413);
    assert.equal(review.body.error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal((await request(app).post('/api/auth/login').send({ email: 'a@example.com', password: huge })).status, 413);
    assert.equal((await request(app).post('/api/auth/register').send({ email: `${'a'.repeat(300)}@example.com`, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD })).status, 400);
  });

  test('a server failure gives a friendly message without internal details', async () => {
    const { agent, db } = await createTestApp();
    db.close(); // the database is gone
    for (const res of [await agent.get('/api/reviews'), await agent.post('/api/auth/login').send({ email: 'a@example.com', password: TEST_PASSWORD })]) {
      assert.equal(res.status, 500);
      const body = JSON.stringify(res.body);
      assert.match(res.body.error.message, /Please try again/);
      assert.ok(!/sqlite|libsql|select |insert |\.js|node_modules|[A-Z]:\\|\/server\/| at /i.test(body), body);
    }
  });

  test('the audit log records security events without secrets', async () => {
    const { app, db, outbox, user } = await createTestApp();
    await request(app).post('/api/auth/login').send({ email: user.email, password: 'Wrong12345' });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    await agent.post('/api/auth/logout').send({});

    const events = (await db.execute('SELECT * FROM security_events ORDER BY id')).rows;
    assert.deepEqual(events.map((row) => row.event), ['registration_started', 'email_verified', 'login_failed', 'login', 'logout']);
    assert.ok(events.slice(1).every((row) => row.user_id === user.id));
    const text = JSON.stringify(events);
    assert.ok(!text.includes(TEST_PASSWORD) && !text.includes('Wrong12345') && !text.includes(lastCode(outbox, user.email)));
  });
});
