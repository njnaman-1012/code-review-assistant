// Data-access layer for the AI token allowance: "user_ai_usage" (the balance
// of each user) and "ai_usage_logs" (one row per AI request).
//
// tokens_used + tokens_remaining always equals tokens_allocated.
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
// tokens_used after adding :delta, kept between 0 and the allocation.
const NEW_USED = 'MAX(0, MIN(tokens_allocated, tokens_used + :delta))';

export function createUsageModel(db) {
  return {
    async findByUser(userId) {
      const { rows } = await db.execute({
        sql: 'SELECT tokens_allocated, tokens_used, tokens_remaining FROM user_ai_usage WHERE user_id = ?',
        args: [userId],
      });
      if (!rows.length) return null;
      return { allocated: rows[0].tokens_allocated, used: rows[0].tokens_used, remaining: rows[0].tokens_remaining };
    },

    // Takes `tokens` out of the balance, but only if the user has that many
    // left. It is a single UPDATE, so two requests at the same moment cannot
    // both spend the same tokens. Returns false when the balance is too low.
    async reserve(userId, tokens) {
      const result = await db.execute({
        sql: `UPDATE user_ai_usage
              SET tokens_used = tokens_used + :tokens, tokens_remaining = tokens_remaining - :tokens, updated_at = ${NOW}
              WHERE user_id = :userId AND tokens_remaining >= :tokens`,
        args: { userId, tokens },
      });
      return result.rowsAffected > 0;
    },

    // Replaces a reservation with the tokens the request really used and
    // writes the usage log (one transaction).
    async settle({ userId, reserved, tokensUsed, requestId, feature }) {
      const statements = [{
        sql: `UPDATE user_ai_usage
              SET tokens_used = ${NEW_USED}, tokens_remaining = tokens_allocated - ${NEW_USED}, updated_at = ${NOW}
              WHERE user_id = :userId`,
        args: { userId, delta: tokensUsed - reserved },
      }];
      if (tokensUsed > 0) {
        statements.push({
          sql: 'INSERT INTO ai_usage_logs (user_id, request_id, feature, tokens_used) VALUES (?, ?, ?, ?)',
          args: [userId, requestId, feature, tokensUsed],
        });
      }
      await db.batch(statements, 'write');
    },

    // Administrator only (scripts/setUserTokens.js): a new allowance, nothing used.
    async resetAllowance(userId, tokensAllocated) {
      const result = await db.execute({
        sql: `UPDATE user_ai_usage
              SET tokens_allocated = :tokens, tokens_used = 0, tokens_remaining = :tokens, updated_at = ${NOW}
              WHERE user_id = :userId`,
        args: { userId, tokens: tokensAllocated },
      });
      return result.rowsAffected > 0;
    },

    async findLogs(userId, limit = 50) {
      const { rows } = await db.execute({
        sql: `SELECT request_id, feature, tokens_used, created_at FROM ai_usage_logs
              WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
        args: [userId, limit],
      });
      return rows.map((row) => ({ requestId: row.request_id, feature: row.feature, tokensUsed: row.tokens_used, createdAt: row.created_at }));
    },
  };
}
