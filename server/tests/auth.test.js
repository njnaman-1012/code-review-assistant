// User accounts: registration, e-mail verification (one-time code), login,
// sessions, password reset and data isolation.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import request from 'supertest';
import { createDatabase } from '../database/db.js';
import { createApp } from '../app.js';
import { createAiReviewService } from '../services/aiReviewService.js';
import { hashPassword, verifyPassword, needsRehash } from '../utils/password.js';
import {
  createTestApp, createRoutingProvider, registerUser, lastCode, clearRateLimits, testConfig,
  validAiReview, PYTHON_CODE, TEST_PASSWORD,
} from './helpers.js';

const credentials = (email, password = TEST_PASSWORD) => ({ email, password, confirmPassword: password });
const login = (app, body) => request(app).post('/api/auth/login').send(body);
// A cookie set by a response, and its "name=value" part.
const cookie = (res, name) => (res.headers['set-cookie'] ?? []).find((value) => value.startsWith(`${name}=`));
const cookiePair = (res, name) => cookie(res, name).split(';')[0];
const userRow = async (db, email) => (await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] })).rows[0];

// Starts a registration in a new "browser" (agent) without verifying it.
async function signUp(app, email, password = TEST_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send(credentials(email, password));
  return { agent, res };
}
const verify = (agent, otp) => agent.post('/api/auth/verify-email').send({ otp });

describe('Registration', () => {
  test('creates a pending account, hashes the password and e-mails a code', async () => {
    const { app, db, outbox } = await createTestApp();
    const { agent, res } = await signUp(app, 'New.Student@Example.com');

    assert.equal(res.status, 201);
    assert.deepEqual(res.body.data.verification, { email: 'n******@example.com', purpose: 'verify', expiresInSeconds: 600, resendInSeconds: 60 });

    // The account exists but is not active: no login, no session, no AI tokens yet.
    const row = await userRow(db, 'new.student@example.com');
    assert.equal(row.email_verified, 0);
    assert.equal(cookie(res, 'cra_session'), undefined);
    assert.equal((await agent.get('/api/auth/me')).status, 401);
    assert.equal((await agent.get('/api/reviews')).status, 401);
    assert.equal((await db.execute({ sql: 'SELECT COUNT(*) AS n FROM user_ai_usage WHERE user_id = ?', args: [row.id] })).rows[0].n, 0);

    // The password is stored only as a salted hash and is never sent back.
    assert.match(row.password_hash, /^(argon2id\$m=\d+,t=\d+,p=\d+|scrypt\$N=\d+,r=\d+,p=\d+)\$[\w-]+\$[\w-]+$/);
    assert.ok(!row.password_hash.includes(TEST_PASSWORD));
    assert.equal(await verifyPassword(TEST_PASSWORD, row.password_hash), true);

    // The code went to the address by e-mail - not into the response, and not into the database as text.
    const code = lastCode(outbox, 'new.student@example.com');
    assert.match(code, /^\d{6}$/);
    assert.equal(outbox.at(-1).to, 'new.student@example.com');
    const body = JSON.stringify(res.body) + JSON.stringify(res.headers);
    assert.ok(!body.includes(code) && !body.includes(TEST_PASSWORD) && !/password|hash/i.test(JSON.stringify(res.body)));
    const saved = (await db.execute({ sql: 'SELECT * FROM email_verification_codes WHERE user_id = ?', args: [row.id] })).rows[0];
    assert.match(saved.otp_hash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(saved).includes(code));

    // The browser is remembered with an httpOnly cookie (JavaScript cannot read it).
    assert.match(cookie(res, 'cra_verify'), /HttpOnly/);
    assert.match(cookie(res, 'cra_verify'), /SameSite=Lax/);
  });

  test('two users never share a password hash, even with the same password', async () => {
    const { app, db } = await createTestApp();
    await signUp(app, 'a@example.com');
    await signUp(app, 'b@example.com');
    assert.notEqual((await userRow(db, 'a@example.com')).password_hash, (await userRow(db, 'b@example.com')).password_hash);
  });

  test('rejects an invalid e-mail address', async () => {
    const { app, outbox } = await createTestApp();
    const sent = outbox.length;
    for (const email of ['', 'not-an-email', 'a@b', 'a b@example.com', '@example.com', 'a@@example.com', '<b>x</b>@example.com', 42, null, ['a@example.com']]) {
      const res = await request(app).post('/api/auth/register').send(credentials(email));
      assert.equal(res.status, 400, String(email));
      assert.equal(res.body.error.code, 'INVALID_EMAIL');
    }
    assert.equal(outbox.length, sent, 'no e-mail for invalid input');
  });

  test('rejects a weak password and a wrong confirmation', async () => {
    const { app, db } = await createTestApp();
    for (const password of ['short1', 'onlyletters', '1234567890', '', 12345678, null]) {
      const res = await request(app).post('/api/auth/register').send(credentials('weak@example.com', password));
      assert.equal(res.status, 400, String(password));
      assert.equal(res.body.error.code, 'WEAK_PASSWORD');
    }
    const mismatch = await request(app).post('/api/auth/register')
      .send({ email: 'weak@example.com', password: TEST_PASSWORD, confirmPassword: 'Different123' });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.error.code, 'PASSWORD_MISMATCH');
    assert.equal(await userRow(db, 'weak@example.com'), undefined, 'no account was created');
  });

  test('an address that already has an account gets the same answer, and the account is untouched', async () => {
    const { app, db, outbox } = await createTestApp();
    await registerUser(app, 'dup@example.com');
    const before = await userRow(db, 'dup@example.com');
    await clearRateLimits(db);

    for (const email of ['dup@example.com', 'DUP@Example.com', '  dup@example.com ']) {
      const { agent, res } = await signUp(app, email, 'Another123');
      const fresh = await signUp(app, `fresh${outbox.length}@example.com`, 'Another123');

      // Nothing in the answer tells whether the address was registered before.
      assert.equal(res.status, 201, email);
      assert.equal(res.status, fresh.res.status);
      assert.deepEqual(Object.keys(res.body.data.verification), Object.keys(fresh.res.body.data.verification));
      assert.equal(res.body.data.verification.email, 'd**@example.com');
      assert.ok(cookie(res, 'cra_verify'));
      assert.equal(cookie(res, 'cra_session'), undefined);

      // The owner is told by e-mail; it contains no code, and no code can be "verified".
      const notice = outbox.filter((mail) => mail.to === 'dup@example.com').at(-1);
      assert.match(notice.subject, /already have/);
      assert.ok(!/\d{6}/.test(notice.text));
      assert.equal((await verify(agent, '000000')).body.error.code, 'OTP_INCORRECT');
      assert.equal((await agent.get('/api/auth/me')).status, 401);
      await clearRateLimits(db);
    }

    assert.equal((await db.execute("SELECT COUNT(*) AS n FROM users WHERE email = 'dup@example.com'")).rows[0].n, 1);
    assert.equal((await userRow(db, 'dup@example.com')).password_hash, before.password_hash, 'the password was not replaced');
    assert.equal((await login(app, { email: 'dup@example.com', password: 'Another123' })).status, 401);
    assert.equal((await login(app, { email: 'dup@example.com', password: TEST_PASSWORD })).status, 200);
  });

  test('registering a pending address again replaces its password; only the newest code and browser count', async () => {
    const { app, db, outbox } = await createTestApp();
    const first = await signUp(app, 'pending@example.com', 'FirstPass123');
    const firstCode = lastCode(outbox, 'pending@example.com');
    await clearRateLimits(db);
    const second = await signUp(app, 'pending@example.com', 'SecondPass123');
    const secondCode = lastCode(outbox, 'pending@example.com');

    // The first browser can no longer verify - not with its own code and not with the new one.
    assert.equal((await verify(first.agent, firstCode)).body.error.code, 'OTP_INVALID');
    assert.equal((await verify(first.agent, secondCode)).body.error.code, 'OTP_INVALID');
    assert.equal((await userRow(db, 'pending@example.com')).email_verified, 0);

    // The second browser verifies; the account has the password of that registration.
    assert.equal((await verify(second.agent, secondCode)).status, 200);
    assert.equal((await login(app, { email: 'pending@example.com', password: 'FirstPass123' })).status, 401);
    assert.equal((await login(app, { email: 'pending@example.com', password: 'SecondPass123' })).status, 200);
    assert.equal((await db.execute("SELECT COUNT(*) AS n FROM users WHERE email = 'pending@example.com'")).rows[0].n, 1);
  });

  test('fields that only the server may set are ignored', async () => {
    const { app, db } = await createTestApp();
    const res = await request(app).post('/api/auth/register')
      .send({ ...credentials('sneaky@example.com'), email_verified: 1, emailVerified: true, disabled: 0, id: 1, role: 'admin', user_id: 1 });
    assert.equal(res.status, 201);
    const row = await userRow(db, 'sneaky@example.com');
    assert.equal(row.email_verified, 0);
    assert.notEqual(row.id, 1);
    await clearRateLimits(db);
    assert.equal((await login(app, credentials('sneaky@example.com'))).status, 403, 'still has to verify the e-mail address');
  });

  test('registration is refused when no e-mail can be sent', async () => {
    // Deployed without an e-mail provider: nobody could ever verify an address.
    const db = await createDatabase({ url: ':memory:' });
    const app = createApp({ db, aiReviewService: createAiReviewService(null), config: { ...testConfig, email: { provider: 'none' } } });
    const res = await request(app).post('/api/auth/register').send(credentials('nobody@example.com'));
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'EMAIL_UNAVAILABLE');
    assert.equal(await userRow(db, 'nobody@example.com'), undefined);

    // The provider is down: the user can try again at once (no cooldown was used up).
    const { app: working, emailService, outbox } = await createTestApp();
    emailService.failing = true;
    assert.equal((await signUp(working, 'retry@example.com')).res.status, 503);
    emailService.failing = false;
    assert.equal((await signUp(working, 'retry@example.com')).res.status, 201);
    assert.match(lastCode(outbox, 'retry@example.com'), /^\d{6}$/);
  });
});

describe('E-mail verification with a one-time code', () => {
  test('the correct code activates the account, allocates the AI tokens and logs the user in', async () => {
    const { app, db, outbox } = await createTestApp();
    const { agent } = await signUp(app, 'verify@example.com');
    const code = lastCode(outbox, 'verify@example.com');

    const pending = await agent.get('/api/auth/verification');
    assert.equal(pending.status, 200);
    assert.equal(pending.body.data.verification.email, 'v*****@example.com');

    const res = await verify(agent, code);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.email, 'verify@example.com');
    assert.deepEqual(res.body.data.usage, { allocated: 100000, used: 0, remaining: 100000, percentRemaining: 100 });
    assert.match(cookie(res, 'cra_session'), /HttpOnly/);
    assert.match(cookie(res, 'cra_session'), /SameSite=Lax/);
    assert.match(cookie(res, 'cra_verify'), /^cra_verify=;/, 'the verification cookie is removed');
    assert.equal((await userRow(db, 'verify@example.com')).email_verified, 1);

    // The session token is random; the database has only its hash.
    const token = cookiePair(res, 'cra_session').split('=')[1];
    const sessions = (await db.execute('SELECT token_hash FROM sessions')).rows;
    assert.ok(sessions.every((row) => row.token_hash !== token && /^[0-9a-f]{64}$/.test(row.token_hash)));

    // First-time flow: straight to the (empty) dashboard.
    assert.equal((await agent.get('/api/auth/me')).body.data.user.email, 'verify@example.com');
    assert.equal((await agent.get('/api/reviews')).body.data.total, 0);
    assert.equal((await agent.get('/api/auth/verification')).status, 404, 'nothing is pending any more');
  });

  test('a code works only once', async () => {
    const { app, outbox } = await createTestApp();
    const { agent, res } = await signUp(app, 'once@example.com');
    const code = lastCode(outbox, 'once@example.com');
    assert.equal((await verify(agent, code)).status, 200);

    // The same code again - with the same browser cookie as before.
    const again = await request(app).post('/api/auth/verify-email').set('Cookie', cookiePair(res, 'cra_verify')).send({ otp: code });
    assert.equal(again.status, 400);
    assert.equal(again.body.error.code, 'OTP_INVALID');
    assert.equal(cookie(again, 'cra_session'), undefined);
  });

  test('a wrong code is rejected, and after too many attempts even the right code is refused', async () => {
    const { app, db, outbox } = await createTestApp();
    const { agent } = await signUp(app, 'guess@example.com');
    const code = lastCode(outbox, 'guess@example.com');
    const wrong = code === '123456' ? '654321' : '123456';

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await verify(agent, wrong);
      assert.equal(res.status, 400, `attempt ${attempt}`);
      assert.equal(res.body.error.code, 'OTP_INCORRECT');
      assert.ok(!JSON.stringify(res.body).includes(code));
    }
    const locked = await verify(agent, code);
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, 'OTP_TOO_MANY_ATTEMPTS');
    assert.equal((await userRow(db, 'guess@example.com')).email_verified, 0);

    // A new code works again.
    await clearRateLimits(db);
    assert.equal((await agent.post('/api/auth/resend-otp').send({})).status, 200);
    assert.equal((await verify(agent, lastCode(outbox, 'guess@example.com'))).status, 200);
  });

  test('guesses sent at the same moment cannot get extra attempts', async () => {
    const { app, db, outbox } = await createTestApp();
    const { agent } = await signUp(app, 'parallel@example.com');
    const code = lastCode(outbox, 'parallel@example.com');
    const wrong = code === '111111' ? '222222' : '111111';
    const results = await Promise.all(Array.from({ length: 12 }, () => verify(agent, wrong)));
    assert.equal(results.filter((res) => res.body.error.code === 'OTP_INCORRECT').length, 5);
    assert.equal(results.filter((res) => res.body.error.code === 'OTP_TOO_MANY_ATTEMPTS').length, 7);
    assert.equal((await db.execute("SELECT attempts FROM email_verification_codes WHERE email = 'parallel@example.com'")).rows[0].attempts, 5);
  });

  test('an expired code is rejected', async () => {
    const { app, db, outbox } = await createTestApp();
    const { agent } = await signUp(app, 'late@example.com');
    await db.execute("UPDATE email_verification_codes SET expires_at = '2020-01-01T00:00:00.000Z'");
    const res = await verify(agent, lastCode(outbox, 'late@example.com'));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'OTP_EXPIRED');
    assert.equal((await userRow(db, 'late@example.com')).email_verified, 0);
    assert.equal((await agent.get('/api/auth/verification')).status, 404);
  });

  test('a code works only in the browser that asked for it, and must be 6 digits', async () => {
    const { app, db, outbox } = await createTestApp();
    const { agent } = await signUp(app, 'mine@example.com');
    const code = lastCode(outbox, 'mine@example.com');

    // Somebody else who learned the code (but has no verification cookie).
    for (const body of [{ otp: code }, { otp: code, email: 'mine@example.com' }, { otp: code, user_id: 2 }]) {
      const res = await request(app).post('/api/auth/verify-email').send(body);
      assert.equal(res.body.error.code, 'OTP_INVALID');
    }
    assert.equal((await request(app).post('/api/auth/verify-email').set('Cookie', 'cra_verify=made-up').send({ otp: code })).body.error.code, 'OTP_INVALID');

    for (const otp of ['', '12345', '1234567', 'abcdef', '12 456', 123456, null, ['123456'], "' OR '1'='1"]) {
      const res = await verify(agent, otp);
      assert.equal(res.status, 400, String(otp));
      assert.equal(res.body.error.code, 'INVALID_OTP_FORMAT');
    }
    const { attempts } = (await db.execute("SELECT attempts FROM email_verification_codes WHERE email = 'mine@example.com'")).rows[0];
    assert.equal(attempts, 0, 'malformed input and other browsers do not use up attempts');
    assert.equal((await verify(agent, code)).status, 200);
  });

  test('resending is limited: one code per minute and a few per hour; a new code replaces the old one', async () => {
    const { app, db, outbox } = await createTestApp();
    const { agent } = await signUp(app, 'again@example.com');
    const firstCode = lastCode(outbox, 'again@example.com');
    const sentTo = () => outbox.filter((mail) => mail.to === 'again@example.com').length;
    const endCooldown = () => db.execute("DELETE FROM rate_limits WHERE key LIKE 'otp-send:%'");

    // Too soon (also for a second registration of the same address).
    const tooSoon = await agent.post('/api/auth/resend-otp').send({});
    assert.equal(tooSoon.status, 429);
    assert.equal(tooSoon.body.error.code, 'OTP_COOLDOWN');
    assert.match(tooSoon.body.error.message, /wait \d+ seconds/);
    assert.equal((await signUp(app, 'again@example.com')).res.status, 429);
    assert.equal(sentTo(), 1);

    // After the cooldown: a new code; the old one no longer works.
    await endCooldown();
    const resent = await agent.post('/api/auth/resend-otp').send({});
    assert.equal(resent.status, 200);
    assert.equal(resent.body.data.verification.resendInSeconds, 60);
    assert.ok(!JSON.stringify(resent.body).includes(lastCode(outbox, 'again@example.com')));
    assert.equal(sentTo(), 2);
    assert.equal((await db.execute("SELECT COUNT(*) AS n FROM email_verification_codes WHERE email = 'again@example.com'")).rows[0].n, 1);
    if (firstCode !== lastCode(outbox, 'again@example.com')) {
      assert.equal((await verify(agent, firstCode)).body.error.code, 'OTP_INCORRECT');
    }

    // At most 5 codes per address per hour.
    for (let sent = 3; sent <= 5; sent += 1) {
      await endCooldown();
      assert.equal((await agent.post('/api/auth/resend-otp').send({})).status, 200, `code ${sent}`);
    }
    await endCooldown();
    const capped = await agent.post('/api/auth/resend-otp').send({});
    assert.equal(capped.status, 429);
    assert.equal(capped.body.error.code, 'OTP_LIMIT_REACHED');
    assert.equal(sentTo(), 5);

    // Without a pending verification there is nothing to resend.
    assert.equal((await request(app).post('/api/auth/resend-otp').send({})).body.error.code, 'NO_PENDING_VERIFICATION');
  });
});

describe('Login and sessions', () => {
  test('logs in with the right password and keeps the user logged in', async () => {
    const { app } = await createTestApp();
    await registerUser(app, 'login@example.com');

    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ email: 'Login@Example.com', password: TEST_PASSWORD });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.email, 'login@example.com');
    assert.equal(res.body.data.usage.remaining, 100000);
    assert.ok(!/password|hash/i.test(JSON.stringify(res.body)));

    // The same session works for later requests (page refresh, navigation).
    for (let i = 0; i < 3; i += 1) assert.equal((await agent.get('/api/auth/me')).status, 200);
    assert.equal((await agent.get('/api/reviews')).status, 200);
  });

  test('a wrong password and an unknown e-mail get the same answer', async () => {
    const { app } = await createTestApp();
    await registerUser(app, 'known@example.com');
    const wrongPassword = await login(app, { email: 'known@example.com', password: 'Wrong12345' });
    const unknownEmail = await login(app, { email: 'nobody@example.com', password: TEST_PASSWORD });
    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(wrongPassword.body, unknownEmail.body);
    assert.equal(wrongPassword.body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(wrongPassword.headers['set-cookie'], undefined);

    assert.equal((await login(app, {})).status, 400);
    assert.equal((await login(app, { email: 'known@example.com' })).status, 400);
    // Not a string: must not crash or bypass the check.
    assert.equal((await login(app, { email: 'known@example.com', password: { $ne: '' } })).status, 400);
    assert.equal((await login(app, { email: ['known@example.com'], password: TEST_PASSWORD })).status, 400);
  });

  test('an unverified account cannot log in: the right password leads to the verification step', async () => {
    const { app, db, outbox } = await createTestApp();
    await signUp(app, 'unverified@example.com');
    const sent = () => outbox.filter((mail) => mail.to === 'unverified@example.com').length;

    // A wrong password gets the usual answer (it does not reveal that the account is pending).
    const wrong = await login(app, { email: 'unverified@example.com', password: 'Wrong12345' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');

    await clearRateLimits(db);
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ email: 'unverified@example.com', password: TEST_PASSWORD });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'EMAIL_NOT_VERIFIED');
    assert.equal(res.body.data.verification.email, 'u******@example.com');
    assert.equal(cookie(res, 'cra_session'), undefined);
    assert.equal((await agent.get('/api/auth/me')).status, 401);
    assert.equal(sent(), 2, 'a new code was e-mailed');

    assert.equal((await verify(agent, lastCode(outbox, 'unverified@example.com'))).status, 200);
    assert.equal((await agent.get('/api/auth/me')).status, 200);
  });

  test('repeated wrong passwords pause the login for that address (brute-force protection)', async () => {
    const { app, db } = await createTestApp({ config: { auth: { login: { maxFailures: 4, lockMs: 15 * 60 * 1000 } } } });
    await registerUser(app, 'target@example.com');

    for (const email of ['target@example.com', 'nobody@example.com']) {
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        assert.equal((await login(app, { email, password: `Guess${attempt}000` })).status, 401);
      }
      // Now even the correct password is refused - and an unknown address behaves the same.
      const blocked = await login(app, { email, password: TEST_PASSWORD });
      assert.equal(blocked.status, 429, email);
      assert.equal(blocked.body.error.code, 'TOO_MANY_ATTEMPTS');
      assert.match(blocked.body.error.message, /try again in 15 minutes/);
      assert.equal(blocked.headers['set-cookie'], undefined);
    }
    // The pause ends by itself.
    await db.execute('UPDATE rate_limits SET reset_at = 1');
    assert.equal((await login(app, { email: 'target@example.com', password: TEST_PASSWORD })).status, 200);

    // A successful login clears the count.
    for (let attempt = 1; attempt <= 3; attempt += 1) await login(app, { email: 'target@example.com', password: 'Guess0000' });
    assert.equal((await login(app, { email: 'target@example.com', password: TEST_PASSWORD })).status, 200);
    for (let attempt = 1; attempt <= 3; attempt += 1) await login(app, { email: 'target@example.com', password: 'Guess0000' });
    assert.equal((await login(app, { email: 'target@example.com', password: TEST_PASSWORD })).status, 200);
  });

  test('every login gets a new session; the previous one of that browser ends', async () => {
    const { app } = await createTestApp();
    await registerUser(app, 'rotate@example.com');
    const agent = request.agent(app);
    const first = await agent.post('/api/auth/login').send({ email: 'rotate@example.com', password: TEST_PASSWORD });
    const second = await agent.post('/api/auth/login').send({ email: 'rotate@example.com', password: TEST_PASSWORD });
    assert.notEqual(cookiePair(first, 'cra_session'), cookiePair(second, 'cra_session'));
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookiePair(first, 'cra_session'))).status, 401);
    assert.equal((await agent.get('/api/auth/me')).status, 200);
  });

  test('protected API routes reject requests without a valid session', async () => {
    const { app, agent } = await createTestApp({ provider: createRoutingProvider({ review: validAiReview() }) });
    const { id } = (await agent.post('/api/reviews').send({ language: 'python', code: PYTHON_CODE })).body.data;

    const anonymous = [
      request(app).get('/api/auth/me'),
      request(app).get('/api/reviews'),
      request(app).post('/api/reviews').send({ language: 'python', code: PYTHON_CODE }),
      request(app).get(`/api/reviews/${id}`),
      request(app).get(`/api/reviews/${id}/report?format=html`),
      request(app).delete(`/api/reviews/${id}`),
      request(app).post(`/api/reviews/${id}/correct`).send({}),
      request(app).post(`/api/reviews/${id}/improve`).send({}),
      // Invented or tampered session cookies.
      request(app).get('/api/reviews').set('Cookie', 'cra_session=made-up-token'),
      request(app).get('/api/reviews').set('Cookie', 'cra_session=1'),
      request(app).get('/api/reviews').set('Cookie', `cra_session=${'x'.repeat(5000)}`),
      request(app).get(`/api/reviews/${id}`).set('Authorization', 'Bearer 1').set('X-User-Id', '1'),
    ];
    for (const res of await Promise.all(anonymous)) {
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHENTICATED');
      assert.ok(!JSON.stringify(res.body).includes('import os'), 'no data in the error');
    }
    assert.equal((await agent.get(`/api/reviews/${id}`)).status, 200, 'the review was not deleted');
  });

  test('an expired session is rejected', async () => {
    const { agent, db } = await createTestApp();
    assert.equal((await agent.get('/api/auth/me')).status, 200);
    await db.execute("UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z'");
    assert.equal((await agent.get('/api/auth/me')).status, 401);
    assert.equal((await agent.get('/api/reviews')).status, 401);
  });

  test('a disabled account loses its sessions and cannot log in', async () => {
    const { app, agent, db, user } = await createTestApp();
    await db.execute({ sql: 'UPDATE users SET disabled = 1 WHERE id = ?', args: [user.id] });
    assert.equal((await agent.get('/api/auth/me')).status, 401);
    assert.equal((await agent.get('/api/reviews')).status, 401);
    const res = await login(app, { email: user.email, password: TEST_PASSWORD });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ACCOUNT_DISABLED');
    assert.equal(cookie(res, 'cra_session'), undefined);
  });

  test('logout ends the session on the server', async () => {
    const { app, db } = await createTestApp();
    const { user } = await registerUser(app, 'bye@example.com');
    const agent = request.agent(app);
    const loggedIn = await agent.post('/api/auth/login').send({ email: 'bye@example.com', password: TEST_PASSWORD });
    const oldCookie = cookiePair(loggedIn, 'cra_session');
    const sessionCount = async () => (await db.execute({ sql: 'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', args: [user.id] })).rows[0].n;
    assert.equal((await agent.get('/api/reviews')).status, 200);
    const before = await sessionCount();

    const out = await agent.post('/api/auth/logout').send({});
    assert.equal(out.status, 200);
    assert.match(cookie(out, 'cra_session'), /^cra_session=;/, 'the cookie is removed');
    assert.equal(await sessionCount(), before - 1, 'the session row is deleted');

    // Protected API and "pages" (which load /api/auth/me) are no longer accessible ...
    assert.equal((await agent.get('/api/auth/me')).status, 401);
    assert.equal((await agent.get('/api/reviews')).status, 401);
    assert.equal((await agent.post('/api/reviews').send({ language: 'python', code: PYTHON_CODE })).status, 401);
    // ... even when the old cookie is sent again by hand.
    assert.equal((await request(app).get('/api/reviews').set('Cookie', oldCookie)).status, 401);

    // Logging in again works and logging out twice is harmless.
    assert.equal((await agent.post('/api/auth/logout').send({})).status, 200);
    assert.equal((await agent.post('/api/auth/login').send({ email: 'bye@example.com', password: TEST_PASSWORD })).status, 200);
    assert.equal((await agent.get('/api/reviews')).status, 200);
  });

  test('requests that change data are refused when they come from another website (CSRF)', async () => {
    const { app } = await createTestApp({ register: false, config: { auth: { cookieSecure: true }, clientOrigins: ['https://app.example.com'] } });
    const post = (origin) => request(app).post('/api/auth/logout').set('Origin', origin).set('Host', 'app.example.com').send({});
    const foreign = await post('https://evil.example.net');
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.error.code, 'FORBIDDEN_ORIGIN');
    assert.equal((await post('http://localhost:5173')).status, 403, 'localhost is only allowed in development');
    assert.equal((await post('https://app.example.com')).status, 200);
  });

  test('development: the local dev server may call the API from any local port', async () => {
    const { app } = await createTestApp(); // cookieSecure: false, like "npm run dev"
    const send = (origin) => request(app).post('/api/auth/login').set('Origin', origin).send({ email: 'x@example.com', password: 'Whatever123' });
    assert.equal((await send('http://localhost:5173')).status, 401, 'reaches the login check');
    assert.equal((await send('http://localhost:5174')).status, 401);
    assert.equal((await send('http://127.0.0.1:5173')).status, 401);
    assert.equal((await send('https://evil.example.net')).status, 403);
    const { res } = await signUp(app, 'dev@example.com');
    assert.ok(!/; Secure/.test(cookie(res, 'cra_verify')), 'plain http://localhost keeps the cookie');
  });

  test('cookies are HTTPS-only when deployed', async () => {
    const { app, outbox } = await createTestApp({ register: false, config: { auth: { cookieSecure: true } } });
    const res = await request(app).post('/api/auth/register').send(credentials('secure@example.com'));
    assert.match(cookie(res, 'cra_verify'), /; Secure/);
    const verified = await request(app).post('/api/auth/verify-email')
      .set('Cookie', cookiePair(res, 'cra_verify')).send({ otp: lastCode(outbox, 'secure@example.com') });
    assert.match(cookie(verified, 'cra_session'), /; Secure/);
    assert.match(cookie(verified, 'cra_session'), /HttpOnly/);
  });
});

describe('Password reset', () => {
  const forgot = (agent, email) => agent.post('/api/auth/forgot-password').send({ email });
  const reset = (agent, otp, password = 'BrandNew123') => agent.post('/api/auth/reset-password').send({ otp, password, confirmPassword: password });

  test('a code sent by e-mail lets the owner choose a new password; every login of the account ends', async () => {
    const { app, db, outbox } = await createTestApp();
    const { agent: oldSession } = await registerUser(app, 'forgot@example.com');
    await clearRateLimits(db);

    const agent = request.agent(app);
    const asked = await forgot(agent, 'Forgot@Example.com');
    assert.equal(asked.status, 200);
    assert.deepEqual(asked.body.data.verification, { email: 'f*****@example.com', purpose: 'reset', expiresInSeconds: 600, resendInSeconds: 60 });
    const code = lastCode(outbox, 'forgot@example.com');
    assert.match(outbox.at(-1).subject, /password reset code/);
    assert.ok(!JSON.stringify(asked.body).includes(code));

    // A weak password or a wrong confirmation is refused without using up an attempt.
    assert.equal((await reset(agent, code, 'weak')).body.error.code, 'WEAK_PASSWORD');
    const mismatch = await agent.post('/api/auth/reset-password').send({ otp: code, password: 'BrandNew123', confirmPassword: 'Other12345' });
    assert.equal(mismatch.body.error.code, 'PASSWORD_MISMATCH');
    // A reset code is not a verification code.
    assert.equal((await verify(agent, code)).body.error.code, 'OTP_INVALID');
    assert.equal((await reset(agent, code === '123456' ? '654321' : '123456')).body.error.code, 'OTP_INCORRECT');

    const done = await reset(agent, code);
    assert.equal(done.status, 200);
    assert.equal(done.body.data.passwordChanged, true);

    assert.equal((await login(app, { email: 'forgot@example.com', password: TEST_PASSWORD })).status, 401, 'the old password no longer works');
    assert.equal((await login(app, { email: 'forgot@example.com', password: 'BrandNew123' })).status, 200);
    assert.equal((await oldSession.get('/api/auth/me')).status, 401, 'sessions from before the reset are ended');
    assert.equal((await reset(agent, code, 'AnotherOne123')).body.error.code, 'OTP_INVALID', 'the code works once');
    assert.equal((await userRow(db, 'forgot@example.com')).email_verified, 1);
    const balance = await db.execute("SELECT tokens_remaining FROM user_ai_usage WHERE user_id = (SELECT id FROM users WHERE email = 'forgot@example.com')");
    assert.equal(balance.rows[0].tokens_remaining, 100000, 'a reset does not touch the token balance');
  });

  test('an unknown or unverified address gets the same answer, no e-mail and no usable code', async () => {
    const { app, db, outbox } = await createTestApp();
    await registerUser(app, 'real@example.com');
    await signUp(app, 'pending@example.com');
    await clearRateLimits(db);

    const real = await forgot(request.agent(app), 'real@example.com');
    for (const email of ['ghost@example.com', 'pending@example.com']) {
      const before = outbox.length;
      const agent = request.agent(app);
      const res = await forgot(agent, email);
      assert.equal(res.status, real.status, email);
      assert.deepEqual(Object.keys(res.body.data.verification), Object.keys(real.body.data.verification));
      assert.ok(cookie(res, 'cra_verify'));
      assert.equal(outbox.length, before, 'nothing is sent to an address without a usable account');
      assert.equal((await reset(agent, '123456')).body.error.code, 'OTP_INCORRECT');
    }
    assert.equal(await userRow(db, 'ghost@example.com'), undefined);
    assert.equal((await forgot(request(app), 'not-an-email')).body.error.code, 'INVALID_EMAIL');
  });

  test('reset codes expire, have limited attempts and are bound to the browser', async () => {
    const { app, db, outbox } = await createTestApp();
    await registerUser(app, 'limits@example.com');
    await clearRateLimits(db);
    const agent = request.agent(app);
    await forgot(agent, 'limits@example.com');
    const code = lastCode(outbox, 'limits@example.com');

    assert.equal((await reset(request(app), code)).body.error.code, 'OTP_INVALID', 'another browser');
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      assert.equal((await reset(agent, code === '111111' ? '222222' : '111111')).body.error.code, 'OTP_INCORRECT');
    }
    assert.equal((await reset(agent, code)).body.error.code, 'OTP_TOO_MANY_ATTEMPTS');

    await clearRateLimits(db);
    await forgot(agent, 'limits@example.com');
    await db.execute("UPDATE email_verification_codes SET expires_at = '2020-01-01T00:00:00.000Z'");
    assert.equal((await reset(agent, lastCode(outbox, 'limits@example.com'))).body.error.code, 'OTP_EXPIRED');
    assert.equal((await login(app, { email: 'limits@example.com', password: TEST_PASSWORD })).status, 200, 'the password is unchanged');
  });
});

describe('Password hashing', () => {
  test('hashes are salted, verifiable and never contain the password', async () => {
    const first = await hashPassword('Correct-Horse-1');
    const second = await hashPassword('Correct-Horse-1');
    assert.notEqual(first, second);
    assert.ok(!first.includes('Correct-Horse-1'));
    assert.equal(await verifyPassword('Correct-Horse-1', first), true);
    assert.equal(await verifyPassword('correct-horse-1', first), false);
    assert.equal(needsRehash(first), false);
    for (const damaged of ['', null, undefined, 'plain-text-password', 'scrypt$zz', 'argon2id$m=1$x', `${first}x`]) {
      assert.equal(await verifyPassword('Correct-Horse-1', damaged), false, String(damaged));
    }
  });

  test('a hash made by an earlier version still works and is upgraded at the next login', async () => {
    const { app, db, user } = await createTestApp();
    const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const legacy = `scrypt$${salt.toString('hex')}$${scryptSync(TEST_PASSWORD, salt, 64).toString('hex')}`;
    assert.equal(needsRehash(legacy), true);
    await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [legacy, user.id] });

    assert.equal((await login(app, { email: user.email, password: 'Wrong12345' })).status, 401);
    assert.equal((await login(app, { email: user.email, password: TEST_PASSWORD })).status, 200);
    const upgraded = (await userRow(db, user.email)).password_hash;
    assert.notEqual(upgraded, legacy);
    assert.equal(needsRehash(upgraded), false);
    assert.equal((await login(app, { email: user.email, password: TEST_PASSWORD })).status, 200);
  });
});

describe('Data isolation between users', () => {
  // Two users on the same application, each with one review.
  async function twoUsers() {
    const provider = createRoutingProvider({ review: validAiReview() });
    const { app, db, agent: alice, user: aliceUser } = await createTestApp({ provider });
    const { agent: bob, user: bobUser } = await registerUser(app, 'bob@example.com');
    const aliceReview = (await alice.post('/api/reviews').send({ language: 'python', code: PYTHON_CODE })).body.data;
    const bobReview = (await bob.post('/api/reviews').send({ language: 'javascript', code: 'var secretOfBob = 1;' })).body.data;
    return { app, db, provider, alice, bob, aliceUser, bobUser, aliceReview, bobReview };
  }

  test('each account sees only its own reviews', async () => {
    const { alice, bob, aliceReview, bobReview, aliceUser, bobUser } = await twoUsers();
    assert.notEqual(aliceUser.id, bobUser.id, 'every user has an own internal ID');

    const aliceList = (await alice.get('/api/reviews')).body.data;
    assert.equal(aliceList.total, 1);
    assert.deepEqual(aliceList.reviews.map((r) => r.id), [aliceReview.id]);

    const bobList = (await bob.get('/api/reviews')).body.data;
    assert.equal(bobList.total, 1);
    assert.deepEqual(bobList.reviews.map((r) => r.id), [bobReview.id]);
    assert.ok(!JSON.stringify(bobList).includes('import os'), "nothing of Alice's code in Bob's history");
    assert.ok(!JSON.stringify(aliceList).includes('secretOfBob'));
  });

  test('a user cannot open, download, change or delete a review of another user', async () => {
    const { alice, bob, provider, db, aliceReview, bobUser } = await twoUsers();
    const id = aliceReview.id;

    const attempts = [
      bob.get(`/api/reviews/${id}`),
      bob.get(`/api/reviews/${id}/report?format=html`),
      bob.get(`/api/reviews/${id}/report?format=md`),
      bob.delete(`/api/reviews/${id}`),
      bob.post(`/api/reviews/${id}/correct`).send({}),
      bob.post(`/api/reviews/${id}/improve`).send({}),
      // Methods the API does not offer at all.
      bob.put(`/api/reviews/${id}`).send({ originalCode: 'hacked' }),
      bob.patch(`/api/reviews/${id}`).send({ user_id: bobUser.id }),
    ];
    for (const res of await Promise.all(attempts)) {
      assert.equal(res.status, 404, 'same answer as for a review that does not exist');
      assert.ok(!JSON.stringify(res.body).includes('import os'));
    }
    assert.equal(provider.callsFor('correct').length + provider.callsFor('improve').length, 0, 'the AI was not called');
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM code_actions')).rows[0].n, 0);

    // Alice still has her review, unchanged.
    const mine = await alice.get(`/api/reviews/${id}`);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.originalCode, PYTHON_CODE);
    assert.equal((await bob.get('/api/auth/me')).body.data.user.id, bobUser.id);
  });

  test('the AI only receives data of the user who asked', async () => {
    const { bob, provider } = await twoUsers();
    provider.calls.length = 0;
    await bob.post('/api/reviews').send({ language: 'javascript', code: 'var another = 2;' });
    assert.equal(provider.calls.length, 1);
    for (const call of provider.calls) {
      assert.ok(!`${call.system}${call.prompt}`.includes('def average'), "Alice's code is never part of Bob's AI request");
      assert.match(call.prompt, /var another = 2;/);
    }
  });

  test('a user ID sent by the browser is ignored', async () => {
    const { alice, bob, db, aliceUser, bobUser, aliceReview } = await twoUsers();
    const id = aliceUser.id;

    // Bob names Alice's ID in the query, the body and headers.
    const list = await bob.get(`/api/reviews?userId=${id}&user_id=${id}`).set('X-User-Id', String(id));
    assert.equal(list.body.data.total, 1);
    assert.ok(list.body.data.reviews.every((r) => r.id !== aliceReview.id));
    assert.equal((await bob.get(`/api/reviews/${aliceReview.id}?userId=${id}`)).status, 404);
    assert.equal((await bob.get(`/api/auth/me?userId=${id}`)).body.data.user.id, bobUser.id);

    // A review created with a foreign user ID still belongs to the logged-in user.
    const created = await bob.post('/api/reviews').send({ language: 'python', code: 'x = 1\n', userId: id, user_id: id });
    assert.equal(created.status, 201);
    const { rows } = await db.execute({ sql: 'SELECT user_id FROM reviews WHERE id = ?', args: [created.body.data.id] });
    assert.equal(rows[0].user_id, bobUser.id);
    assert.equal((await alice.get('/api/reviews')).body.data.total, 1);
  });

  test('reviews saved before user accounts existed are not visible to anyone', async () => {
    const { alice, bob, db } = await twoUsers();
    await db.execute("INSERT INTO reviews (language, original_code) VALUES ('python', 'legacy = True')");
    const legacyId = Number((await db.execute('SELECT MAX(id) AS id FROM reviews')).rows[0].id);
    for (const agent of [alice, bob]) {
      assert.equal((await agent.get(`/api/reviews/${legacyId}`)).status, 404);
      assert.equal((await agent.get('/api/reviews')).body.data.total, 1);
    }
  });
});
