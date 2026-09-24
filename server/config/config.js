// Central configuration. Every value comes from environment variables
// (loaded from server/.env by server.js) with a safe default.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProviderChain } from '../services/ai/providers/resolveProviderChain.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// DATABASE_URL may be "file:./database/x.db", "./database/x.db" or ":memory:".
function resolveDatabasePath(value) {
  if (!value) return path.join(serverRoot, 'database', 'code_review.db');
  if (value === ':memory:') return value;
  const withoutScheme = value.startsWith('file:') ? value.slice(5) : value;
  return path.isAbsolute(withoutScheme) ? withoutScheme : path.resolve(serverRoot, withoutScheme);
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: toNumber(process.env.PORT, 5000),
  // Comma-separated list of front-end origins allowed by CORS.
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  databasePath: resolveDatabasePath(process.env.DATABASE_URL),
  // In production the API server also serves the built React app (npm run build).
  clientDistPath: process.env.NODE_ENV === 'production' || process.env.SERVE_CLIENT === 'true'
    ? path.resolve(serverRoot, '..', 'client', 'dist')
    : null,
  // Number of proxies in front of the server (set TRUST_PROXY=1 on Render, Railway, ...).
  trustProxy: Number(process.env.TRUST_PROXY) || 0,

  ai: {
    // Ordered list of providers to try (AI_PROVIDER=auto uses the free ones).
    chain: resolveProviderChain(process.env),
    maxOutputTokens: toNumber(process.env.AI_MAX_OUTPUT_TOKENS, 32000),
    timeoutMs: toNumber(process.env.AI_TIMEOUT_MS, 120000),
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
