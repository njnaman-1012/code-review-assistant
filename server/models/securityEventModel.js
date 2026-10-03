// Data-access layer for the "security_events" audit log.

export function createSecurityEventModel(db) {
  return {
    async record({ userId = null, event, detail = null }) {
      await db.execute({
        sql: 'INSERT INTO security_events (user_id, event, detail) VALUES (?, ?, ?)',
        args: [userId, event, detail],
      });
    },

    // Administrator (scripts/admin.js): the newest events first.
    async findRecent(limit = 50) {
      const { rows } = await db.execute({
        sql: `SELECT security_events.created_at, security_events.event, security_events.detail, users.email
              FROM security_events LEFT JOIN users ON users.id = security_events.user_id
              ORDER BY security_events.id DESC LIMIT ?`,
        args: [limit],
      });
      return rows.map((row) => ({ createdAt: row.created_at, event: row.event, email: row.email, detail: row.detail }));
    },
  };
}
