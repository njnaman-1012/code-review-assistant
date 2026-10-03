// The e-mail service: which provider is used, what is sent to it, and what
// happens when it is not configured. No real e-mail is sent: fetch is replaced.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createEmailService, verificationEmail, passwordResetEmail, alreadyRegisteredEmail } from '../services/emailService.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// Replaces fetch and records the requests.
function stubFetch(status = 200) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(status < 300 ? { id: 'ok' } : { message: 'sender not verified' }), { status });
  };
  return calls;
}

const message = { to: 'student@example.com', ...verificationEmail({ appName: 'CodeReview AI', code: '123456', minutes: 10 }) };

describe('E-mail service', () => {
  test('Brevo: the key is sent in a header to the Brevo API', async () => {
    const calls = stubFetch();
    const service = createEmailService({ provider: 'brevo', apiKey: 'secret-key', from: 'me@example.com', fromName: 'CodeReview AI' });
    assert.equal(service.isConfigured(), true);
    await service.send(message);
    assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(calls[0].headers['api-key'], 'secret-key');
    assert.deepEqual(calls[0].body.sender, { name: 'CodeReview AI', email: 'me@example.com' });
    assert.deepEqual(calls[0].body.to, [{ email: 'student@example.com' }]);
    assert.match(calls[0].body.textContent, /123456/);
    assert.match(calls[0].body.htmlContent, /123456/);
  });

  test('Resend: the key is sent as a bearer token to the Resend API', async () => {
    const calls = stubFetch();
    await createEmailService({ provider: 'resend', apiKey: 're_secret', from: 'no-reply@my-domain.com', fromName: 'CodeReview AI' }).send(message);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].headers.Authorization, 'Bearer re_secret');
    assert.equal(calls[0].body.from, 'CodeReview AI <no-reply@my-domain.com>');
    assert.deepEqual(calls[0].body.to, ['student@example.com']);
  });

  test('a refused message is an error (so the user is told and can try again)', async () => {
    stubFetch(401);
    const service = createEmailService({ provider: 'brevo', apiKey: 'wrong', from: 'me@example.com' });
    await assert.rejects(service.send(message), /401/);
  });

  test('without a provider, key or sender nothing can be sent', async () => {
    const calls = stubFetch();
    for (const settings of [undefined, {}, { provider: 'none' }, { provider: 'brevo' }, { provider: 'brevo', apiKey: 'k' }, { provider: 'unknown', apiKey: 'k', from: 'a@b.co' }]) {
      const service = createEmailService(settings);
      assert.equal(service.isConfigured(), false, JSON.stringify(settings));
      await assert.rejects(service.send(message));
    }
    // The terminal printout is for development only: a deployed server never uses it.
    assert.equal(createEmailService({ provider: 'console', allowConsole: false }).isConfigured(), false);
    assert.equal(createEmailService({ provider: 'console', allowConsole: true }).isConfigured(), true);
    assert.equal(calls.length, 0);
  });

  test('the messages contain the code only where one is expected', () => {
    for (const build of [verificationEmail, passwordResetEmail]) {
      const mail = build({ appName: 'CodeReview <AI>', code: '654321', minutes: 10 });
      assert.match(mail.subject, /654321/);
      assert.match(mail.text, /654321/);
      assert.match(mail.text, /10 minutes/);
      assert.ok(mail.html.includes('CodeReview &lt;AI&gt;') && !mail.html.includes('<AI>'), 'values are escaped in the HTML part');
    }
    const notice = alreadyRegisteredEmail({ appName: 'CodeReview AI' });
    assert.ok(!/\d{6}/.test(notice.text + notice.html + notice.subject));
  });
});
