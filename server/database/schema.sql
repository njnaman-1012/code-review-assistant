-- Code Review Assistant database schema (SQLite).
-- Columns that hold lists or nested objects store JSON text; the model
-- (models/reviewModel.js) serializes on write and parses on read.

-- A registered user. The e-mail address is stored in lower case and is unique;
-- the password is stored only as a salted hash (utils/password.js).
-- email_verified: 0 until the user has entered the code sent to the address
-- (a pending account cannot log in). disabled: set by the administrator.
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,
  password_hash  TEXT    NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  disabled       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Login sessions. The browser holds a random token in an httpOnly cookie; only
-- its SHA-256 hash is stored here. Logging out deletes the row.
CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One-time codes sent by e-mail: 'verify' (activate a new account) and
-- 'reset' (choose a new password). Only hashes are stored. token_hash belongs
-- to a second secret kept in an httpOnly cookie of the browser that asked for
-- the code, so a code only works in that browser. otp_hash is NULL when no
-- code was issued (the address already has an account, or has none); such a
-- row can never be verified, but the answer to the browser looks the same.
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users (id) ON DELETE CASCADE,
  email      TEXT    NOT NULL,
  purpose    TEXT    NOT NULL CHECK (purpose IN ('verify', 'reset')),
  otp_hash   TEXT,
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  used_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON email_verification_codes (email, purpose);

-- Counters for rate limiting (logins, codes, AI requests). They are kept in
-- the database because a serverless host runs many short-lived instances that
-- share no memory. key is a hash; reset_at is a time in milliseconds.
CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT    PRIMARY KEY,
  hits     INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- Audit log of security events (registration, login, failed login, ...).
-- It never contains passwords, codes or session tokens.
CREATE TABLE IF NOT EXISTS security_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  event      TEXT    NOT NULL,
  detail     TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events (created_at DESC);

-- AI token allowance of each user (one row per user). The balance exists only
-- here; the server never accepts token numbers from the browser.
CREATE TABLE IF NOT EXISTS user_ai_usage (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  tokens_allocated INTEGER NOT NULL,
  tokens_used      INTEGER NOT NULL DEFAULT 0,
  tokens_remaining INTEGER NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row per AI request that used tokens (feature: review / correct / improve).
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  request_id  TEXT    NOT NULL,
  feature     TEXT    NOT NULL,
  tokens_used INTEGER NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user ON ai_usage_logs (user_id, created_at DESC);

-- A review belongs to the user who created it (user_id). Databases created
-- before user accounts existed get this column from the migration in db.js.
CREATE TABLE IF NOT EXISTS reviews (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 INTEGER REFERENCES users (id) ON DELETE CASCADE,
  language                TEXT    NOT NULL,
  original_code           TEXT    NOT NULL,
  summary                 TEXT    NOT NULL DEFAULT '',
  logic                   TEXT    NOT NULL DEFAULT '{}',  -- JSON: { explanation, steps[], keyComponents[] }
  issues                  TEXT    NOT NULL DEFAULT '[]',  -- JSON: Issue[]
  issue_count             INTEGER NOT NULL DEFAULT 0,
  quality_score           INTEGER,
  suggestions             TEXT    NOT NULL DEFAULT '[]',  -- JSON: Suggestion[]
  improved_code           TEXT    NOT NULL DEFAULT '',
  improvement_explanation TEXT    NOT NULL DEFAULT '{}',  -- JSON: { changes[], summary{} }
  complexity              TEXT    NOT NULL DEFAULT '{}',  -- JSON: Big-O analysis
  static_analysis         TEXT    NOT NULL DEFAULT '{}',  -- JSON: metrics, tools, language check
  comparison              TEXT,                           -- JSON: original vs improved metrics (nullable)
  final_summary           TEXT    NOT NULL DEFAULT '',
  quality                 TEXT    NOT NULL DEFAULT '{}',  -- JSON: { score, grade, aiScore, counts }
  ai_status               TEXT    NOT NULL DEFAULT 'completed',
  ai_message              TEXT,
  ai_provider             TEXT,
  ai_model                TEXT,
  created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews (created_at DESC);

-- Complete corrected / improved code generated on request for a review
-- ("Fix / Correct Code" and "Improve Code"). One row per review and action;
-- generating again replaces the previous version. Deleting a review deletes
-- its code actions (ON DELETE CASCADE, foreign keys are enabled in db.js).
CREATE TABLE IF NOT EXISTS code_actions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id    INTEGER NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
  action       TEXT    NOT NULL CHECK (action IN ('correct', 'improve')),
  code         TEXT    NOT NULL,                        -- the complete source file
  changes      TEXT    NOT NULL DEFAULT '[]',           -- JSON: [{ title, explanation, problemSolved, lines }]
  summary      TEXT    NOT NULL DEFAULT '',
  checks       TEXT    NOT NULL DEFAULT '{}',           -- JSON: static re-check of the generated code
  ai_provider  TEXT,
  ai_model     TEXT,
  generated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (review_id, action)
);
