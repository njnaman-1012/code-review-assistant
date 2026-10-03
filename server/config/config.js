// Central configuration. Every value comes from environment variables
// (loaded from server/.env by server.js) with a safe default.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveProviderChain } from '../services/ai/providers/resolveProviderChain.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// AI token allowance given to every newly registered user.
export const DEFAULT_USER_TOKENS = 100000;

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// The database is a local SQLite file by default. On Vercel, set TURSO_DATABASE_URL
// (libsql://...) and TURSO_AUTH_TOKEN for the free hosted Turso database.
// DATABASE_URL may be "file:./database/x.db", "./database/x.db", ":memory:" or a libsql:// URL.
function resolveDatabaseUrl(env) {
  const value = env.TURSO_DATABASE_URL || env.DATABASE_URL;
  if (!value) return pathToFileURL(path.join(serverRoot, 'database', 'code_review.db')).href;
  if (value === ':memory:' || /^(libsql|https?|wss?):/.test(value)) return value;
  const withoutScheme = value.startsWith('file:') ? value.slice(5) : value;
  return pathToFileURL(path.isAbsolute(withoutScheme) ? withoutScheme : path.resolve(serverRoot, withoutScheme)).href;
}

// "Deployed" means reachable from the internet: secure cookies, no development helpers.
const isDeployed = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

// EMAIL_PROVIDER, or guessed from the key (Resend keys start with "re_").
function resolveEmailProvider(env) {
  const setting = (env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (setting) return setting;
  if (env.EMAIL_API_KEY) return env.EMAIL_API_KEY.startsWith('re_') ? 'resend' : 'brevo';
  return isDeployed ? 'none' : 'console';
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: toNumber(process.env.PORT, 5000),
  // Comma-separated list of front-end origins that may call the API (CORS and
  // the cross-site request check). FRONTEND_URL and CLIENT_ORIGIN mean the same.
  clientOrigins: (process.env.FRONTEND_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  database: {
    url: resolveDatabaseUrl(process.env),
    authToken: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN || '',
  },
  // In production the API server also serves the built React app (npm run build).
  clientDistPath: process.env.NODE_ENV === 'production' || process.env.SERVE_CLIENT === 'true'
    ? path.resolve(serverRoot, '..', 'client', 'dist')
    : null,
  // Number of proxies in front of the server (set TRUST_PROXY=1 on Render, Railway, ...).
  trustProxy: Number(process.env.TRUST_PROXY) || (process.env.VERCEL ? 1 : 0),

  ai: {
    // Ordered list of providers to try (AI_PROVIDER=auto uses the free ones).
    chain: resolveProviderChain(process.env),
    maxOutputTokens: toNumber(process.env.AI_MAX_OUTPUT_TOKENS, 32000),
    timeoutMs: toNumber(process.env.AI_TIMEOUT_MS, 120000),
    // Total time the AI may use for one review / code action. On Vercel a request
    // is stopped after 300 s, so the AI gets 240 s there by default (0 = no limit).
    timeBudgetMs: toNumber(process.env.AI_TIME_BUDGET_MS, process.env.VERCEL ? 240000 : 0),
    // Anthropic only: re-run a safety-declined request on a fallback model.
    refusalFallback: process.env.AI_REFUSAL_FALLBACK !== 'false',
  },

  auth: {
    // How long a login stays valid.
    sessionTtlMs: toNumber(process.env.SESSION_TTL_HOURS, 24 * 7) * 60 * 60 * 1000,
    // The cookies are sent over HTTPS only when the app is deployed.
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isDeployed,
    // Secret key for the hashes of the one-time codes (any long random text).
    secret: process.env.SESSION_SECRET || '',
    // One-time codes sent by e-mail (verification and password reset).
    otp: {
      ttlMs: toNumber(process.env.OTP_EXPIRY_MINUTES, 10) * 60 * 1000,
      maxAttempts: toNumber(process.env.OTP_MAX_ATTEMPTS, 5),
      resendCooldownMs: toNumber(process.env.OTP_RESEND_COOLDOWN, 60) * 1000, // seconds
      maxPerHour: toNumber(process.env.OTP_MAX_PER_HOUR, 5), // codes per e-mail address
    },
    // After this many wrong passwords for one e-mail address, logging in to it is paused.
    login: {
      maxFailures: toNumber(process.env.LOGIN_MAX_FAILURES, 10),
      lockMs: toNumber(process.env.LOGIN_LOCK_MINUTES, 15) * 60 * 1000,
    },
  },

  // Who sends the one-time codes (services/emailService.js). Without a
  // provider the codes are printed in the terminal during development; a
  // deployed server then refuses registration instead.
  email: {
    provider: resolveEmailProvider(process.env),
    apiKey: process.env.EMAIL_API_KEY || '',
    from: process.env.EMAIL_FROM || '',
    fromName: process.env.EMAIL_FROM_NAME || 'CodeReview AI',
    allowConsole: !isDeployed,
  },

  usage: {
    // AI tokens every newly verified user receives. Change the allowance here
    // (or with DEFAULT_USER_TOKEN_LIMIT / DEFAULT_USER_TOKENS) - nowhere else.
    defaultUserTokens: toNumber(process.env.DEFAULT_USER_TOKEN_LIMIT || process.env.DEFAULT_USER_TOKENS, DEFAULT_USER_TOKENS),
  },

  limits: {
    maxCodeChars: toNumber(process.env.MAX_CODE_CHARS, 20000),
    maxCodeLines: toNumber(process.env.MAX_CODE_LINES, 800),
    jsonBodyLimit: process.env.MAX_REQUEST_SIZE || '200kb',
  },

  rateLimit: {
    windowMs: 15 * 60 * 1000,
    maxRequests: toNumber(process.env.RATE_LIMIT_MAX_REQUESTS, 300),
    // AI requests per user per window (AI_RATE_LIMIT sets both).
    maxReviews: toNumber(process.env.RATE_LIMIT_MAX_REVIEWS || process.env.AI_RATE_LIMIT, 20),
    maxCodeActions: toNumber(process.env.RATE_LIMIT_MAX_CODE_ACTIONS || process.env.AI_RATE_LIMIT, 20),
    // Register / login / forgot-password requests per IP address per window.
    maxAuthAttempts: toNumber(process.env.LOGIN_RATE_LIMIT || process.env.RATE_LIMIT_MAX_AUTH, 30),
    // Code entries and "resend" requests per IP address per window.
    maxOtpRequests: toNumber(process.env.OTP_RATE_LIMIT, 30),
  },
};
