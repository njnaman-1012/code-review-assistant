// Entry point: load configuration, connect the database, create the AI
// providers and start the HTTP server.
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Load server/.env (wherever the process is started from). Must run before
// config.js reads process.env; real environment variables take priority.
dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)), quiet: true });

const { config } = await import('./config/config.js');
const { createDatabase } = await import('./database/db.js');
const { createAiProviders } = await import('./services/ai/providers/index.js');
const { createAiReviewService } = await import('./services/aiReviewService.js');
const { createApp } = await import('./app.js');
const { logger } = await import('./utils/logger.js');

const db = await createDatabase(config.database);
const aiReviewService = createAiReviewService(createAiProviders(config.ai), { skipped: config.ai.chain.skipped });
const app = createApp({ db, aiReviewService, config });

const server = app.listen(config.port, () => {
  const { chain } = aiReviewService.info();
  logger.info(`Code Review Assistant API running on http://localhost:${config.port}`);
  logger.info(`Database: ${config.database.url}`);
  logger.info(`AI tokens for each new user: ${config.usage.defaultUserTokens.toLocaleString('en-US')}`);
  if (chain.length) {
    logger.info(`AI providers (tried in this order): ${chain.map((p) => `${p.label} [${p.model}]`).join(' -> ')}`);
  } else {
    logger.info('AI analysis is turned off - reviews will contain static analysis only');
  }
  if (config.email.provider === 'console') {
    logger.info('E-mail: no provider configured - one-time codes are printed in this terminal (development only)');
  } else if (['brevo', 'resend'].includes(config.email.provider) && config.email.apiKey && config.email.from) {
    logger.info(`E-mail: one-time codes are sent with ${config.email.provider} from ${config.email.from}`);
  } else {
    logger.warn('E-mail is not configured (EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM): registration and password reset are closed');
  }
  if (!config.auth.secret && config.env === 'production') {
    logger.warn('SESSION_SECRET is not set: set it to a long random text');
  }
  for (const skipped of config.ai.chain.skipped) {
    logger.warn(`AI provider "${skipped.name}" skipped: ${skipped.reason}`);
  }
});

// Close the database cleanly when the process is stopped (Ctrl+C).
function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
