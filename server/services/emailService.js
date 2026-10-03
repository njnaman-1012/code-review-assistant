// EMAIL SERVICE - sends the one-time codes. Only the server talks to the
// e-mail provider; the API key never reaches the browser.
//
//   EMAIL_PROVIDER=brevo    Brevo (free: 300 e-mails a day, no own domain needed)
//   EMAIL_PROVIDER=resend   Resend (free: 100 a day, needs your own verified domain)
//   EMAIL_PROVIDER=console  development only: prints the message in the server terminal
//   (nothing set)           development: console; deployed: registration is closed
//
// Both providers are called over HTTPS with fetch, so no extra package is needed.
import { logger } from '../utils/logger.js';

const SEND_TIMEOUT_MS = 15000;

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// The request each provider expects for one e-mail.
const PROVIDERS = {
  brevo: ({ apiKey, from, fromName }, { to, subject, text, html }) => ({
    url: 'https://api.brevo.com/v3/smtp/email',
    headers: { 'api-key': apiKey },
    body: { sender: { name: fromName, email: from }, to: [{ email: to }], subject, textContent: text, htmlContent: html },
  }),
  resend: ({ apiKey, from, fromName }, { to, subject, text, html }) => ({
    url: 'https://api.resend.com/emails',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: { from: `${fromName} <${from}>`, to: [to], subject, text, html },
  }),
};

export function createEmailService({ provider = 'none', apiKey = '', from = '', fromName = 'CodeReview AI', allowConsole = false } = {}) {
  const buildRequest = PROVIDERS[provider];
  const useConsole = provider === 'console' && allowConsole;
  const ready = useConsole || Boolean(buildRequest && apiKey && from);

  return {
    provider,

    // False when no e-mail can be sent (registration is then refused).
    isConfigured() {
      return ready;
    },

    // Throws when the message could not be handed to the provider.
    async send(message) {
      if (!ready) throw new Error('e-mail is not configured');
      if (useConsole) {
        // Development only (never when deployed): there is no inbox, so the message is shown here.
        console.log(`\n--- E-MAIL (development, not sent) ---\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n--------------------------------------\n`);
        return;
      }
      const { url, headers, body } = buildRequest({ apiKey, from, fromName }, message);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!response.ok) {
        // The provider's answer may explain the problem (wrong key, sender not verified, daily limit).
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        logger.error('E-mail provider refused the message', { provider, status: response.status, detail });
        throw new Error(`e-mail provider answered ${response.status}`);
      }
    },
  };
}

// ---- messages -------------------------------------------------------------

function layout(appName, lines) {
  const paragraphs = lines.map((line) => `<p style="margin:0 0 14px">${line}</p>`).join('');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#0f172a;max-width:480px">`
    + `<h2 style="margin:0 0 16px;color:#4f46e5">${escapeHtml(appName)}</h2>${paragraphs}</div>`;
}

const codeBlock = (code) => `<span style="font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(code)}</span>`;

export function verificationEmail({ appName, code, minutes }) {
  return {
    subject: `${code} is your ${appName} verification code`,
    text: `Your ${appName} verification code is ${code}.\n\nIt is valid for ${minutes} minutes and can be used once.\nIf you did not create an account, you can ignore this e-mail.`,
    html: layout(appName, [
      'Enter this code to verify your e-mail address:',
      codeBlock(code),
      `The code is valid for ${minutes} minutes and can be used once.`,
      'If you did not create an account, you can ignore this e-mail.',
    ]),
  };
}

export function passwordResetEmail({ appName, code, minutes }) {
  return {
    subject: `${code} is your ${appName} password reset code`,
    text: `Your ${appName} password reset code is ${code}.\n\nIt is valid for ${minutes} minutes and can be used once.\nIf you did not ask for a new password, you can ignore this e-mail; your password stays the same.`,
    html: layout(appName, [
      'Enter this code to choose a new password:',
      codeBlock(code),
      `The code is valid for ${minutes} minutes and can be used once.`,
      'If you did not ask for a new password, you can ignore this e-mail; your password stays the same.',
    ]),
  };
}

// Sent when somebody registers an address that already has an account.
export function alreadyRegisteredEmail({ appName }) {
  return {
    subject: `You already have a ${appName} account`,
    text: `Somebody tried to create a ${appName} account with this e-mail address, but an account already exists.\n\nIf it was you, log in instead, or use "Forgot password?" on the login page.\nIf it was not you, you can ignore this e-mail; your account is unchanged.`,
    html: layout(appName, [
      'Somebody tried to create an account with this e-mail address, but an account already exists.',
      'If it was you, log in instead, or use <strong>Forgot password?</strong> on the login page.',
      'If it was not you, you can ignore this e-mail; your account is unchanged.',
    ]),
  };
}
