// Central configuration. Every value comes from environment variables
// (loaded from server/.env by server.js) with a safe default.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveProviderChain } from '../services/ai/providers/resolveProviderChain.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: toNumber(process.env.PORT, 5000),
  // Comma-separated list of front-end origins allowed by CORS.
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
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

  limits: {
    maxCodeChars: toNumber(process.env.MAX_CODE_CHARS, 20000),
    maxCodeLines: toNumber(process.env.MAX_CODE_LINES, 800),
    jsonBodyLimit: '200kb',
  },

  rateLimit: {
    windowMs: 15 * 60 * 1000,
    maxRequests: toNumber(process.env.RATE_LIMIT_MAX_REQUESTS, 300),
    maxReviews: toNumber(process.env.RATE_LIMIT_MAX_REVIEWS, 20),
    maxCodeActions: toNumber(process.env.RATE_LIMIT_MAX_CODE_ACTIONS, 20),
  },
};
