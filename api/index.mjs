// Vercel entry point: the whole Express API runs as one Vercel Function.
// vercel.json sends every /api/* request here; the React app (client/dist) is
// served by Vercel's CDN. Settings come from the Vercel dashboard (Environment
// Variables): TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, AI_PROVIDER, GEMINI_API_KEY ...
import { config } from '../server/config/config.js';
import { createDatabase } from '../server/database/db.js';
import { createAiProviders } from '../server/services/ai/providers/index.js';
import { createAiReviewService } from '../server/services/aiReviewService.js';
import { createApp } from '../server/app.js';

let appPromise = null;

// Created once per function instance and reused by the following requests.
async function createAppOnce() {
  if (process.env.VERCEL && !/^(libsql|https?|wss?):/.test(config.database.url)) {
    throw new Error('No hosted database configured: set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the Vercel project settings.');
  }
  const db = await createDatabase(config.database);
  const aiReviewService = createAiReviewService(createAiProviders(config.ai), { skipped: config.ai.chain.skipped });
  return createApp({ db, aiReviewService, config });
}

// Vercel may attach a lazily parsed `req.body` (its "helpers"). Turn it into a
// normal property so Express's JSON parser works in both cases.
function normalizeBody(req) {
  const descriptor = Object.getOwnPropertyDescriptor(req, 'body');
  if (typeof descriptor?.get !== 'function') return;
  const body = req.body; // throws on malformed JSON
  Object.defineProperty(req, 'body', { value: body, writable: true, configurable: true, enumerable: true });
}

function sendError(res, status, code, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ success: false, error: { code, message } }));
}

export default async function handler(req, res) {
  let app;
  try {
    appPromise ??= createAppOnce().catch((error) => { appPromise = null; throw error; });
    app = await appPromise;
  } catch (error) {
    console.error('Startup failed:', error); // visible in the Vercel logs only
    return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'The service is starting or not configured yet. Please try again in a moment.');
  }
  try {
    normalizeBody(req);
  } catch {
    return sendError(res, 400, 'INVALID_JSON', 'The request body is not valid JSON.');
  }
  return app(req, res);
}
