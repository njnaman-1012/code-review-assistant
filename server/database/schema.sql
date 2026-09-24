-- Code Review Assistant database schema (SQLite).
-- Columns that hold lists or nested objects store JSON text; the model
-- (models/reviewModel.js) serializes on write and parses on read.

CREATE TABLE IF NOT EXISTS reviews (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
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
