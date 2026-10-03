import { Router } from 'express';
import {
  validateRegistration, validateLogin, validateOtp, validateForgotPassword, validatePasswordReset,
} from '../middleware/validateAuthRequest.js';

export function createAuthRoutes({ controller, requireAuth, authLimiter, otpLimiter }) {
  const router = Router();

  // Responses about accounts are never cached.
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.post('/register', authLimiter, validateRegistration, controller.register);
  router.post('/login', authLimiter, validateLogin, controller.login);
  router.post('/forgot-password', authLimiter, validateForgotPassword, controller.forgotPassword);

  router.get('/verification', controller.verification);
  router.post('/verify-email', otpLimiter, validateOtp, controller.verifyEmail);
  router.post('/resend-otp', otpLimiter, controller.resendOtp);
  router.post('/reset-password', otpLimiter, validatePasswordReset, controller.resetPassword);

  router.post('/logout', controller.logout);
  router.get('/me', requireAuth, controller.me);

  return router;
}
