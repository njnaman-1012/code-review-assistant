// All communication with the backend goes through this file.
// The frontend never talks to AI services directly - only to our own API.
import axios from 'axios';

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 5 * 60 * 1000, // AI reviews can take a minute or two
  headers: { 'Content-Type': 'application/json' },
});

// The login session is an httpOnly cookie that the browser sends by itself:
// this file never sees or stores a token, and never sends a user ID.

// Callbacks registered by the AuthProvider (context/AuthContext.jsx).
const listeners = { onUsage: null, onUnauthorized: null, onAiRequestFailed: null };
export function setApiListeners(next) {
  Object.assign(listeners, next);
}

http.interceptors.response.use(
  (response) => {
    // AI requests answer with the user's new token balance.
    if (response.data?.usage) listeners.onUsage?.(response.data.usage);
    return response;
  },
  (error) => {
    const url = error.config?.url ?? '';
    // The session ended (logout elsewhere, expired): back to the login page.
    if (error.response?.status === 401 && !url.startsWith('/auth/')) listeners.onUnauthorized?.();
    // A failed AI request may still have used tokens: load the balance again.
    else if (error.config?.method === 'post' && url.startsWith('/reviews')) listeners.onAiRequestFailed?.();
    return Promise.reject(error);
  },
);

// Turns any Axios error into a message that can be shown to the user.
export function getErrorMessage(error) {
  let data = error?.response?.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  if (data?.error?.message) return data.error.message;
  if (error?.code === 'ECONNABORTED') return 'The request timed out. The review may be taking too long - please try again.';
  // 502/503/504 without our JSON error body means the backend itself is unreachable.
  if ([502, 503, 504].includes(error?.response?.status)) {
    return 'The service is not reachable right now. Please try again in a moment.';
  }
  if (error?.response) return 'Something went wrong on the server. Please try again.';
  if (error?.request) return 'Cannot reach the service. Please check your internet connection and try again.';
  return error?.message || 'An unexpected error occurred.';
}

// Generating a complete corrected / improved file can take a few minutes
// with the free AI services (the server may also retry or switch provider).
const CODE_ACTION_TIMEOUT = 10 * 60 * 1000;

// The error code of our API ("EMAIL_NOT_VERIFIED", "OTP_EXPIRED", ...), if the error has one.
export function getErrorCode(error) {
  return error?.response?.data?.error?.code ?? null;
}

export const api = {
  // Accounts. A session is { user, usage } (usage = the AI token balance).
  // A "verification" describes a code that was e-mailed: { email (masked), purpose, expiresInSeconds, resendInSeconds }.
  register: ({ email, password, confirmPassword }) => http
    .post('/auth/register', { email, password, confirmPassword })
    .then((res) => res.data.data.verification),
  getVerification: () => http.get('/auth/verification').then((res) => res.data.data.verification),
  verifyEmail: (otp) => http.post('/auth/verify-email', { otp }).then((res) => res.data.data),
  resendOtp: () => http.post('/auth/resend-otp', {}).then((res) => res.data.data.verification),
  login: ({ email, password }) => http.post('/auth/login', { email, password }).then((res) => res.data.data),
  forgotPassword: (email) => http.post('/auth/forgot-password', { email }).then((res) => res.data.data.verification),
  resetPassword: ({ otp, password, confirmPassword }) => http
    .post('/auth/reset-password', { otp, password, confirmPassword })
    .then((res) => res.data.data),
  logout: () => http.post('/auth/logout', {}).then((res) => res.data.data),
  getSession: () => http.get('/auth/me').then((res) => res.data.data),

  getHealth: () => http.get('/health').then((res) => res.data.data),
  createReview: ({ language, code }) => http.post('/reviews', { language, code }).then((res) => res.data.data),
  listReviews: (params = {}) => http.get('/reviews', { params }).then((res) => res.data.data),
  getReview: (id) => http.get(`/reviews/${id}`).then((res) => res.data.data),
  deleteReview: (id) => http.delete(`/reviews/${id}`).then((res) => res.data.data),
  // "Fix / Correct Code" and "Improve Code" - both return the complete source file.
  correctCode: (id) => http.post(`/reviews/${id}/correct`, {}, { timeout: CODE_ACTION_TIMEOUT }).then((res) => res.data.data),
  improveCode: (id) => http.post(`/reviews/${id}/improve`, {}, { timeout: CODE_ACTION_TIMEOUT }).then((res) => res.data.data),
  getReport: (id, format) => http
    .get(`/reviews/${id}/report`, { params: { format }, responseType: 'text', transformResponse: (body) => body })
    .then((res) => res.data),
};
