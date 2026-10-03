// Data-access layer for the "rate_limits" table: counters that start again
// after a time window. Every operation is one SQL statement, so requests that
// arrive at the same moment are counted correctly.

export function createRateLimitModel(db) {
  return {
    // Counts one event. Returns the number of events in the current window
    // and when the window ends (milliseconds).
    async hit(key, windowMs) {
      const now = Date.now();
      const { rows } = await db.execute({
        sql: `INSERT INTO rate_limits (key, hits, reset_at) VALUES (:key, 1, :resetAt)
              ON CONFLICT (key) DO UPDATE SET
                hits = CASE WHEN reset_at <= :now THEN 1 ELSE hits + 1 END,
                reset_at = CASE WHEN reset_at <= :now THEN :resetAt ELSE reset_at END
              RETURNING hits, reset_at`,
        args: { key, now, resetAt: now + windowMs },
      });
      return { hits: Number(rows[0].hits), resetAt: Number(rows[0].reset_at) };
    },

    // The current count without changing it (0 when the window is over).
    async get(key) {
      const { rows } = await db.execute({
        sql: 'SELECT hits, reset_at FROM rate_limits WHERE key = ? AND reset_at > ?',
        args: [key, Date.now()],
      });
      return rows.length ? { hits: Number(rows[0].hits), resetAt: Number(rows[0].reset_at) } : { hits: 0, resetAt: 0 };
    },

    // Takes back one event (for example when the counted action failed).
    async undo(key) {
      await db.execute({ sql: 'UPDATE rate_limits SET hits = MAX(hits - 1, 0) WHERE key = ?', args: [key] });
    },

    async reset(key) {
      await db.execute({ sql: 'DELETE FROM rate_limits WHERE key = ?', args: [key] });
    },

    async deleteExpired() {
      await db.execute({ sql: 'DELETE FROM rate_limits WHERE reset_at <= ?', args: [Date.now()] });
    },
  };
}
