// Data-access layer for the "sessions" table (who is logged in).

export function createSessionModel(db) {
  return {
    async create({ userId, tokenHash, expiresAt }) {
      await db.execute({
        sql: 'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
        args: [userId, tokenHash, expiresAt],
      });
    },

    // The user of a session that has not expired, or null. A disabled or
    // unverified account has no valid session.
    async findUser(tokenHash, now) {
      const { rows } = await db.execute({
        sql: `SELECT users.id, users.email, users.created_at
              FROM sessions JOIN users ON users.id = sessions.user_id
              WHERE sessions.token_hash = ? AND sessions.expires_at > ?
                AND users.email_verified = 1 AND users.disabled = 0`,
        args: [tokenHash, now],
      });
      return rows.length ? { id: rows[0].id, email: rows[0].email, createdAt: rows[0].created_at } : null;
    },

    async deleteByTokenHash(tokenHash) {
      await db.execute({ sql: 'DELETE FROM sessions WHERE token_hash = ?', args: [tokenHash] });
    },

    async deleteExpired(now) {
      await db.execute({ sql: 'DELETE FROM sessions WHERE expires_at <= ?', args: [now] });
    },
  };
}
