// Registration, e-mail verification, login, logout, password reset and
// "who am I". Secrets travel only in httpOnly cookies, so JavaScript in the
// browser can never read them:
//   cra_session - the login session
//   cra_verify  - ties a one-time code to the browser that asked for it
import { SESSION_COOKIE, VERIFY_COOKIE } from '../middleware/auth.js';
import { readCookie } from '../utils/cookies.js';
import { AppError } from '../utils/AppError.js';

// The verification cookie outlives the code a little, so "Resend" still works after the code expired.
const VERIFY_COOKIE_MS = 60 * 60 * 1000;

export function createAuthController({ authService, usageService, cookieSecure }) {
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: cookieSecure, path: '/' };
  const verifyCookieOptions = { ...cookieOptions, path: '/api/auth' };

  async function sendSession(res, status, { user, token, expiresAt }) {
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
    res.clearCookie(VERIFY_COOKIE, verifyCookieOptions);
    res.status(status).json({ success: true, data: { user, usage: await usageService.getUsage(user.id) } });
  }

  // A code was e-mailed: remember this browser and tell it where the code went (masked).
  function sendVerification(res, status, { token, verification }, body = { success: true }) {
    res.cookie(VERIFY_COOKIE, token, { ...verifyCookieOptions, maxAge: VERIFY_COOKIE_MS });
    res.status(status).json({ ...body, data: { verification } });
  }

  return {
    // POST /api/auth/register - creates a pending account and e-mails the code
    async register(req, res) {
      sendVerification(res, 201, await authService.register(req.authInput));
    },

    // GET /api/auth/verification - the pending code of this browser (for the "Verify e-mail" page)
    async verification(req, res) {
      const verification = await authService.getVerification(readCookie(req, VERIFY_COOKIE));
      if (!verification) throw new AppError('There is nothing to verify. Please start again.', 404, 'NO_PENDING_VERIFICATION');
      res.json({ success: true, data: { verification } });
    },

    // POST /api/auth/verify-email - the code is correct: the account is active and logged in
    async verifyEmail(req, res) {
      await sendSession(res, 200, await authService.verifyEmail(readCookie(req, VERIFY_COOKIE), req.authInput.code));
    },

    // POST /api/auth/resend-otp - a new code (the previous one stops working)
    async resendOtp(req, res) {
      sendVerification(res, 200, await authService.resendCode(readCookie(req, VERIFY_COOKIE)));
    },

    // POST /api/auth/login
    async login(req, res) {
      const result = await authService.login(req.authInput, readCookie(req, SESSION_COOKIE));
      if (result.verificationRequired) {
        // Right password, but the e-mail address was never verified: a new code was sent.
        return sendVerification(res, 403, result, {
          success: false,
          error: { code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email address first. We sent a new code to your email.' },
        });
      }
      return sendSession(res, 200, result);
    },

    // POST /api/auth/forgot-password - e-mails a reset code (same answer for every address)
    async forgotPassword(req, res) {
      sendVerification(res, 200, await authService.forgotPassword(req.authInput));
    },

    // POST /api/auth/reset-password - code + new password; every login of the account ends
    async resetPassword(req, res) {
      await authService.resetPassword(readCookie(req, VERIFY_COOKIE), req.authInput);
      res.clearCookie(VERIFY_COOKIE, verifyCookieOptions);
      res.clearCookie(SESSION_COOKIE, cookieOptions);
      res.json({ success: true, data: { passwordChanged: true } });
    },

    // POST /api/auth/logout - ends the session on the server and removes the cookie
    async logout(req, res) {
      await authService.logout(readCookie(req, SESSION_COOKIE));
      res.clearCookie(SESSION_COOKIE, cookieOptions);
      res.json({ success: true, data: { loggedOut: true } });
    },

    // GET /api/auth/me - the logged-in user and their AI token balance
    async me(req, res) {
      res.json({ success: true, data: { user: req.user, usage: await usageService.getUsage(req.user.id) } });
    },
  };
}
