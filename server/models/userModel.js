// Data-access layer for the "users" table.
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

// The API shape of a user: never contains the password hash.
function rowToUser(row) {
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

export function createUserModel(db) {
  return {
    // The statement that saves a pending (not yet verified) account: a new
    // row, or a new password for an account that is still pending. A verified
    // account is never changed by it. The caller runs it in one transaction
    // with the verification code that belongs to this password.
    pendingStatements({ email, passwordHash }) {
      return [{
        sql: `INSERT INTO users (email, password_hash, email_verified) VALUES (?, ?, 0)
              ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash, updated_at = ${NOW}
              WHERE users.email_verified = 0`,
        args: [email, passwordHash],
      }];
    },

    async createPending({ email, passwordHash }) {
      await db.batch(this.pendingStatements({ email, passwordHash }), 'write');
      return this.findByEmailWithHash(email);
    },

    // The e-mail address was verified: the account becomes usable and gets its
    // AI token allowance (once; one transaction).
    async activate(userId, tokensAllocated) {
      await db.batch([
        { sql: `UPDATE users SET email_verified = 1, updated_at = ${NOW} WHERE id = ?`, args: [userId] },
        {
          sql: `INSERT INTO user_ai_usage (user_id, tokens_allocated, tokens_used, tokens_remaining)
                SELECT ?, ?, 0, ? WHERE NOT EXISTS (SELECT 1 FROM user_ai_usage WHERE user_id = ?)`,
          args: [userId, tokensAllocated, tokensAllocated, userId],
        },
      ], 'write');
      return this.findById(userId);
    },

    async findById(id) {
      const { rows } = await db.execute({ sql: 'SELECT id, email, created_at FROM users WHERE id = ?', args: [id] });
      return rows.length ? rowToUser(rows[0]) : null;
    },

    // Used by the auth service only: the one place that reads the password hash.
    async findByEmailWithHash(email) {
      const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
      if (!rows.length) return null;
      return {
        ...rowToUser(rows[0]),
        passwordHash: rows[0].password_hash,
        emailVerified: rows[0].email_verified === 1,
        disabled: rows[0].disabled === 1,
      };
    },

    async setPasswordHash(userId, passwordHash) {
      await db.execute({ sql: `UPDATE users SET password_hash = ?, updated_at = ${NOW} WHERE id = ?`, args: [passwordHash, userId] });
    },

    // A new password ends every login of the account and uses up its reset codes (one transaction).
    async resetPassword(userId, passwordHash) {
      await db.batch([
        { sql: `UPDATE users SET password_hash = ?, updated_at = ${NOW} WHERE id = ?`, args: [passwordHash, userId] },
        { sql: 'DELETE FROM sessions WHERE user_id = ?', args: [userId] },
        { sql: "DELETE FROM email_verification_codes WHERE user_id = ? AND purpose = 'reset'", args: [userId] },
      ], 'write');
    },

    // Administrator (scripts/admin.js): a disabled account cannot log in and its logins end.
    async setDisabled(userId, disabled) {
      await db.batch([
        { sql: `UPDATE users SET disabled = ?, updated_at = ${NOW} WHERE id = ?`, args: [disabled ? 1 : 0, userId] },
        ...(disabled ? [{ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [userId] }] : []),
      ], 'write');
    },

    // Pending accounts that were never verified hold no data and are removed after a while.
    async deleteStalePending(before) {
      await db.execute({ sql: 'DELETE FROM users WHERE email_verified = 0 AND updated_at < ?', args: [before] });
    },
  };
}
