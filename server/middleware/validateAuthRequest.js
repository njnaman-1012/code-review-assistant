// Validates the requests of /api/auth before any work is done. Only the
// validated values (req.authInput) are used afterwards; every other field
// sent by the browser is ignored.
import { AppError } from '../utils/AppError.js';

// Letters, digits and the usual punctuation only (after lower-casing): no spaces, quotes or angle brackets.
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const OTP_PATTERN = /^\d{6}$/;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// E-mail addresses are compared in lower case ("A@x.com" and "a@x.com" are the same account).
function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readBody(req) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}

function readEmail(body) {
  const email = normalizeEmail(body.email);
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new AppError('Please enter a valid email address.', 400, 'INVALID_EMAIL');
  }
  return email;
}

// A new password: long enough, with a letter and a number, typed twice.
function readNewPassword(body) {
  const { password, confirmPassword } = body;
  const isStrong = typeof password === 'string'
    && password.length >= MIN_PASSWORD_LENGTH
    && /[A-Za-z]/.test(password)
    && /[0-9]/.test(password);
  if (!isStrong) {
    throw new AppError(
      `The password must be at least ${MIN_PASSWORD_LENGTH} characters long and contain at least one letter and one number.`,
      400,
      'WEAK_PASSWORD',
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AppError(`The password may be at most ${MAX_PASSWORD_LENGTH} characters long.`, 400, 'INVALID_PASSWORD');
  }
  if (confirmPassword !== password) {
    throw new AppError('The two passwords do not match.', 400, 'PASSWORD_MISMATCH');
  }
  return password;
}

function readCode(body) {
  const code = typeof body.otp === 'string' ? body.otp.trim() : '';
  if (!OTP_PATTERN.test(code)) throw new AppError('Please enter the 6-digit code from the e-mail.', 400, 'INVALID_OTP_FORMAT');
  return code;
}

// Turns a function that reads the input into Express middleware.
const validator = (read) => (req, res, next) => {
  try {
    req.authInput = read(readBody(req));
    return next();
  } catch (error) {
    return next(error);
  }
};

export const validateRegistration = validator((body) => ({ email: readEmail(body), password: readNewPassword(body) }));

export const validateLogin = validator((body) => {
  const email = normalizeEmail(body.email);
  const { password } = body;
  if (!email || typeof password !== 'string' || password === '') {
    throw new AppError('Please enter your email and password.', 400, 'INVALID_INPUT');
  }
  // Values this long can never belong to an account.
  if (email.length > MAX_EMAIL_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  }
  return { email, password };
});

export const validateOtp = validator((body) => ({ code: readCode(body) }));

export const validateForgotPassword = validator((body) => ({ email: readEmail(body) }));

// The new password is checked before the code, so a weak password does not use up an attempt.
export const validatePasswordReset = validator((body) => ({ password: readNewPassword(body), code: readCode(body) }));
