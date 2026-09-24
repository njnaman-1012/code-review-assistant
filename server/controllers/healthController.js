// GET /api/health - a public status check used by the dashboard.
// It deliberately reveals no internal details (no provider names, models,
// database type or configuration hints); those are written to the server log.
import { isDatabaseHealthy } from '../database/db.js';
import { SUPPORTED_LANGUAGES } from '../utils/constants.js';

export function createHealthController({ db, aiReviewService, limits }) {
  return {
    check(req, res) {
      const healthy = isDatabaseHealthy(db);
      res.status(healthy ? 200 : 503).json({
        success: healthy,
        data: {
          status: healthy ? 'ok' : 'degraded',
          timestamp: new Date().toISOString(),
          ai: { available: aiReviewService.isAvailable() },
          languages: Object.entries(SUPPORTED_LANGUAGES).map(([value, { label, extensions }]) => ({ value, label, extensions })),
          limits: { maxCodeChars: limits.maxCodeChars, maxCodeLines: limits.maxCodeLines },
        },
      });
    },
  };
}
