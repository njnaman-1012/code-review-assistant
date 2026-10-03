// Data-access layer for "email_verification_codes" (one-time codes for
// e-mail verification and password reset). Only hashes are stored here.
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function rowToCode(row) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    purpose: row.purpose,
    otpHash: row.otp_hash,
    expiresAt: row.expires_at,
    attempts: row.attempts,
    usedAt: row.used_at,
  };
}

export function createVerificationModel(db) {
  return {
    // Saves a new code and removes every earlier code of this address and
    // purpose (they stop working). `before` are account changes that belong
    // to the code; everything is one transaction.
    //
    // withUser: the code belongs to the account with this address - but only
    // to a pending account for 'verify' and only to a usable account for
    // 'reset'. Otherwise it belongs to nobody and can never be verified.
    async issue({ email, purpose, otpHash, tokenHash, expiresAt, withUser }, before = []) {
      const account = purpose === 'verify' ? 'email_verified = 0' : 'email_verified = 1 AND disabled = 0';
      await db.batch([
        ...before,
        { sql: 'DELETE FROM email_verification_codes WHERE email = ? AND purpose = ?', args: [email, purpose] },
        {
          sql: `INSERT INTO email_verification_codes (user_id, email, purpose, otp_hash, token_hash, expires_at)
                VALUES (${withUser ? `(SELECT id FROM users WHERE email = ? AND ${account})` : 'NULL'}, ?, ?, ?, ?, ?)`,
          args: [...(withUser ? [email] : []), email, purpose, otpHash, tokenHash, expiresAt],
        },
      ], 'write');
    },

    async findByTokenHash(tokenHash) {
      const { rows } = await db.execute({ sql: 'SELECT * FROM email_verification_codes WHERE token_hash = ?', args: [tokenHash] });
      return rows.length ? rowToCode(rows[0]) : null;
    },

    // Counts one attempt. False when the code has no attempts left (or was
    // used): one UPDATE, so parallel guesses cannot get extra attempts.
    async consumeAttempt(id, maxAttempts) {
      const result = await db.execute({
        sql: 'UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND used_at IS NULL',
        args: [id, maxAttempts],
      });
      return result.rowsAffected > 0;
    },

    // Marks the code as used. False when it was used already (a code works once).
    async markUsed(id) {
      const result = await db.execute({
        sql: `UPDATE email_verification_codes SET used_at = ${NOW} WHERE id = ? AND used_at IS NULL`,
        args: [id],
      });
      return result.rowsAffected > 0;
    },

    async deleteForEmail(email, purpose) {
      await db.execute({ sql: 'DELETE FROM email_verification_codes WHERE email = ? AND purpose = ?', args: [email, purpose] });
    },

    async deleteExpired(now) {
      await db.execute({ sql: 'DELETE FROM email_verification_codes WHERE expires_at <= ?', args: [now] });
    },
  };
}
