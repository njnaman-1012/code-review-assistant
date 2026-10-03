// AUTH SERVICE - accounts, e-mail verification, login, password reset and
// "who is this request from".
//
//   register:  hash password ─► save pending account + one-time code (one transaction)
//              ─► e-mail the 6-digit code ─► the browser gets a verification cookie
//   verify:    cookie + code ─► account verified ─► AI tokens allocated ─► session
//   login:     too many failures? ─► verify password ─► verified? ─► new session
//   reset:     e-mail a code ─► cookie + code + new password ─► all sessions ended
//   session:   a random token in an httpOnly cookie; the database stores only
//              its SHA-256 hash together with the expiry date
//
// A code works only (a) in the browser that asked for it, (b) for a few
// minutes, (c) once and (d) for a few attempts. The answers do not tell
// whether an e-mail address has an account: registering an existing address
// and asking a reset for an unknown one look the same as the normal case.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { hashPassword, verifyPassword, needsRehash } from '../utils/password.js';
import { verificationEmail, passwordResetEmail, alreadyRegisteredEmail } from './emailService.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

const HOUR_MS = 60 * 60 * 1000;
const STALE_PENDING_MS = 24 * HOUR_MS;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const newOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0'); // cryptographically secure
const secondsUntil = (time) => Math.max(0, Math.ceil((time - Date.now()) / 1000));

// "naman@gmail.com" -> "n*****@gmail.com"
export function maskEmail(email) {
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  return `${local[0]}${'*'.repeat(Math.min(Math.max(local.length - 1, 1), 6))}${email.slice(at)}`;
}

// The same answer for an unknown e-mail and a wrong password.
const invalidCredentials = () => new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
const codeNoLongerValid = () => new AppError('This code is no longer valid. Please request a new one.', 400, 'OTP_INVALID');

export function createAuthService({
  userModel, sessionModel, verificationModel, rateLimitModel, securityEventModel, emailService,
  settings: { sessionTtlMs, defaultUserTokens, secret = '', appName = 'CodeReview AI', otp, login },
}) {
  let dummyHash; // verified when the e-mail is unknown, so both cases take the same time
  const otpMinutes = Math.round(otp.ttlMs / 60000);

  // Counters are stored under a hash, not under the e-mail address itself.
  const limitKey = (kind, email) => `${kind}:${sha256(email)}`;
  // The code is stored as a keyed hash: the database alone does not reveal it.
  const hashOtp = (tokenHash, code) => createHmac('sha256', secret).update(`${tokenHash}:${code}`).digest('hex');
  const sameHash = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

  // Audit log: what happened and to which account - never passwords, codes or tokens.
  async function audit(event, userId = null, detail = null) {
    logger.info(`Security event: ${event}`, { userId, detail });
    try {
      await securityEventModel.record({ userId, event, detail });
    } catch (error) {
      logger.error('Could not write the security event', { event, error: error.message });
    }
  }

  async function startSession(user) {
    const token = newToken();
    const expiresAt = new Date(Date.now() + sessionTtlMs);
    await sessionModel.create({ userId: user.id, tokenHash: sha256(token), expiresAt: expiresAt.toISOString() });
    return { user, token, expiresAt };
  }

  // What the browser may know about a pending code.
  const describe = ({ email, purpose, expiresAt, resendAt }) => ({
    email: maskEmail(email),
    purpose,
    expiresInSeconds: secondsUntil(new Date(expiresAt).getTime()),
    resendInSeconds: secondsUntil(resendAt),
  });

  // Creates a new code for an address (earlier codes stop working) and e-mails it.
  //   hasAccount: false = nothing can be verified (the row exists only so that the answer looks the same)
  //   accountStatements: account changes saved in the same transaction as the code
  //   buildEmail(code): the message to send, or null for none
  async function issueCode({ email, purpose, hasAccount, accountStatements = [], buildEmail }) {
    if (!emailService.isConfigured()) {
      logger.error('E-mail is not configured (EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM): no code can be sent');
      throw new AppError('Sending e-mail is not available right now. Please try again later.', 503, 'EMAIL_UNAVAILABLE');
    }

    // One code per address per cooldown and a few per hour - for every address, known or not.
    const sendKey = limitKey('otp-send', email);
    const hourKey = limitKey('otp-hour', email);
    const cooldown = await rateLimitModel.hit(sendKey, otp.resendCooldownMs);
    if (cooldown.hits > 1) {
      throw new AppError(`A code was sent a moment ago. Please wait ${secondsUntil(cooldown.resetAt)} seconds before asking for another one.`, 429, 'OTP_COOLDOWN');
    }
    const hour = await rateLimitModel.hit(hourKey, HOUR_MS);
    if (hour.hits > otp.maxPerHour) {
      await audit('otp_limit_reached', null, purpose);
      throw new AppError('Too many codes were requested for this address. Please try again in an hour.', 429, 'OTP_LIMIT_REACHED');
    }

    const token = newToken();
    const tokenHash = sha256(token);
    const code = hasAccount ? newOtp() : null;
    const expiresAt = new Date(Date.now() + otp.ttlMs).toISOString();
    await verificationModel.issue(
      { email, purpose, tokenHash, expiresAt, otpHash: code ? hashOtp(tokenHash, code) : null, withUser: hasAccount },
      accountStatements,
    );

    try {
      const message = buildEmail?.(code);
      if (message) await emailService.send({ to: email, ...message });
    } catch (error) {
      // Nothing was delivered: the user may try again at once.
      await rateLimitModel.reset(sendKey);
      await rateLimitModel.undo(hourKey);
      logger.error('Could not send the e-mail', { purpose, error: error.message });
      throw new AppError('We could not send the e-mail. Please try again in a few minutes.', 503, 'EMAIL_UNAVAILABLE');
    }
    return { token, verification: describe({ email, purpose, expiresAt, resendAt: cooldown.resetAt }) };
  }

  // Checks a code typed by the user. Every call costs one attempt.
  async function checkCode(token, code, purpose) {
    const tokenHash = token ? sha256(token) : null;
    const row = tokenHash ? await verificationModel.findByTokenHash(tokenHash) : null;
    if (!row || row.purpose !== purpose || row.usedAt) throw codeNoLongerValid();
    if (row.expiresAt <= new Date().toISOString()) {
      throw new AppError('This code has expired. Please request a new one.', 400, 'OTP_EXPIRED');
    }
    if (!(await verificationModel.consumeAttempt(row.id, otp.maxAttempts))) {
      await audit('otp_too_many_attempts', row.userId, purpose);
      throw new AppError('Too many incorrect attempts. Please request a new code.', 429, 'OTP_TOO_MANY_ATTEMPTS');
    }
    if (!row.userId || !row.otpHash || !sameHash(row.otpHash, hashOtp(tokenHash, code))) {
      await audit('otp_incorrect', row.userId, purpose);
      throw new AppError('The code is not correct.', 400, 'OTP_INCORRECT');
    }
    if (!(await verificationModel.markUsed(row.id))) throw codeNoLongerValid(); // a code works once
    return row;
  }

  // Old rows that are no longer needed. A failure here never fails the request.
  async function cleanUp() {
    const now = new Date().toISOString();
    try {
      await Promise.all([
        sessionModel.deleteExpired(now),
        verificationModel.deleteExpired(now),
        rateLimitModel.deleteExpired(),
        userModel.deleteStalePending(new Date(Date.now() - STALE_PENDING_MS).toISOString()),
      ]);
    } catch (error) {
      logger.warn('Clean-up of expired rows failed', { error: error.message });
    }
  }

  return {
    // Creates a pending account and e-mails the verification code.
    // Returns { token (for the verification cookie), verification }.
    async register({ email, password }) {
      const passwordHash = await hashPassword(password); // for every address, so the answer takes the same time
      const existing = await userModel.findByEmailWithHash(email);
      const taken = Boolean(existing?.emailVerified);

      const issued = await issueCode({
        email,
        purpose: 'verify',
        hasAccount: !taken,
        // A pending account gets the new password together with the new code,
        // so a code always belongs to the password of the same registration.
        accountStatements: taken ? [] : userModel.pendingStatements({ email, passwordHash }),
        buildEmail: (code) => (taken ? alreadyRegisteredEmail({ appName }) : verificationEmail({ appName, code, minutes: otpMinutes })),
      });
      await audit(taken ? 'registration_existing_email' : 'registration_started', existing?.id ?? null);
      await cleanUp();
      return issued;
    },

    // The pending code of this browser, or null.
    async getVerification(token) {
      const row = token ? await verificationModel.findByTokenHash(sha256(token)) : null;
      if (!row || row.usedAt || row.expiresAt <= new Date().toISOString()) return null;
      const cooldown = await rateLimitModel.get(limitKey('otp-send', row.email));
      return describe({ ...row, resendAt: cooldown.resetAt });
    },

    // A new code for the pending verification or password reset of this browser.
    async resendCode(token) {
      const row = token ? await verificationModel.findByTokenHash(sha256(token)) : null;
      if (!row || row.usedAt) throw new AppError('There is nothing to verify. Please start again.', 400, 'NO_PENDING_VERIFICATION');
      const hasAccount = Boolean(row.userId && row.otpHash);
      const template = row.purpose === 'reset' ? passwordResetEmail : verificationEmail;
      return issueCode({
        email: row.email,
        purpose: row.purpose,
        hasAccount,
        buildEmail: hasAccount ? (code) => template({ appName, code, minutes: otpMinutes }) : null,
      });
    },

    // The code is correct: the account becomes usable, gets its AI tokens and is logged in.
    async verifyEmail(token, code) {
      const row = await checkCode(token, code, 'verify');
      const user = await userModel.activate(row.userId, defaultUserTokens);
      if (!user) throw codeNoLongerValid();
      await verificationModel.deleteForEmail(row.email, 'verify');
      await audit('email_verified', user.id);
      return startSession(user);
    },

    // Returns a session, or { verificationRequired, token, verification } for
    // a correct password of an account whose e-mail is not verified yet.
    async login({ email, password }, currentToken) {
      const failKey = limitKey('login-fail', email);
      const failures = await rateLimitModel.get(failKey);
      if (failures.hits >= login.maxFailures) {
        await audit('login_blocked');
        const minutes = Math.max(1, Math.ceil(secondsUntil(failures.resetAt) / 60));
        throw new AppError(`Too many failed login attempts. Please try again in ${minutes} minutes.`, 429, 'TOO_MANY_ATTEMPTS');
      }

      const found = await userModel.findByEmailWithHash(email);
      let passwordCorrect = false;
      if (found) {
        passwordCorrect = await verifyPassword(password, found.passwordHash);
      } else {
        dummyHash ??= await hashPassword('no-such-user');
        await verifyPassword(password, dummyHash);
      }
      if (!passwordCorrect) {
        await rateLimitModel.hit(failKey, login.lockMs); // counted for every address, known or not
        await audit('login_failed', found?.id ?? null);
        throw invalidCredentials();
      }

      if (found.disabled) {
        await audit('login_disabled_account', found.id);
        throw new AppError('This account has been disabled. Please contact the administrator.', 403, 'ACCOUNT_DISABLED');
      }
      if (!found.emailVerified) {
        const issued = await issueCode({
          email,
          purpose: 'verify',
          hasAccount: true,
          buildEmail: (code) => verificationEmail({ appName, code, minutes: otpMinutes }),
        });
        return { verificationRequired: true, ...issued };
      }

      await rateLimitModel.reset(failKey);
      if (needsRehash(found.passwordHash)) await userModel.setPasswordHash(found.id, await hashPassword(password));
      // A login always gets a new session; the one of this browser (if any) ends.
      if (currentToken) await sessionModel.deleteByTokenHash(sha256(currentToken));
      await audit('login', found.id);
      return startSession({ id: found.id, email: found.email, createdAt: found.createdAt });
    },

    // E-mails a reset code if the address has a usable account. The answer is the same either way.
    async forgotPassword({ email }) {
      const user = await userModel.findByEmailWithHash(email);
      const hasAccount = Boolean(user?.emailVerified && !user.disabled);
      const issued = await issueCode({
        email,
        purpose: 'reset',
        hasAccount,
        buildEmail: hasAccount ? (code) => passwordResetEmail({ appName, code, minutes: otpMinutes }) : null,
      });
      await audit('password_reset_requested', hasAccount ? user.id : null);
      return issued;
    },

    // Code + new password: the password changes and every login of the account ends.
    async resetPassword(token, { code, password }) {
      const row = await checkCode(token, code, 'reset');
      await userModel.resetPassword(row.userId, await hashPassword(password));
      await rateLimitModel.reset(limitKey('login-fail', row.email));
      await audit('password_reset', row.userId);
    },

    async logout(token) {
      if (!token) return;
      const tokenHash = sha256(token);
      const user = await sessionModel.findUser(tokenHash, new Date().toISOString());
      await sessionModel.deleteByTokenHash(tokenHash);
      if (user) await audit('logout', user.id);
    },

    // The logged-in user of a session token, or null (unknown, logged out, expired, disabled).
    async authenticate(token) {
      if (!token || typeof token !== 'string' || token.length > 200) return null;
      return sessionModel.findUser(sha256(token), new Date().toISOString());
    },
  };
}
