// Data-access layer for the "code_actions" table: the complete corrected and
// improved code generated on request for a review.
import { toJson, fromJson } from '../utils/jsonUtils.js';

export const CODE_ACTIONS = ['correct', 'improve'];

// Converts a database row to the API shape. Which AI provider/model produced
// the code is stored for the developer but never sent to the public API.
function rowToCodeAction(row) {
  return {
    action: row.action,
    code: row.code,
    changes: fromJson(row.changes, []),
    summary: row.summary,
    checks: fromJson(row.checks, {}),
    generatedAt: row.generated_at,
  };
}

// Generating the same action again replaces the previous version.
const UPSERT_SQL = `
  INSERT INTO code_actions (review_id, action, code, changes, summary, checks, ai_provider, ai_model, generated_at)
  VALUES (:reviewId, :action, :code, :changes, :summary, :checks, :aiProvider, :aiModel,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (review_id, action) DO UPDATE SET
    code = excluded.code,
    changes = excluded.changes,
    summary = excluded.summary,
    checks = excluded.checks,
    ai_provider = excluded.ai_provider,
    ai_model = excluded.ai_model,
    generated_at = excluded.generated_at`;

export function createCodeActionModel(db) {
  return {
    async save({ reviewId, action, code, changes, summary, checks, aiProvider, aiModel }) {
      await db.execute({
        sql: UPSERT_SQL,
        args: {
          reviewId,
          action,
          code,
          changes: toJson(changes, []),
          summary: summary ?? '',
          checks: toJson(checks, {}),
          aiProvider: aiProvider ?? null,
          aiModel: aiModel ?? null,
        },
      });
      return this.find(reviewId, action);
    },

    async find(reviewId, action) {
      const { rows } = await db.execute({
        sql: 'SELECT * FROM code_actions WHERE review_id = ? AND action = ?',
        args: [reviewId, action],
      });
      return rows.length ? rowToCodeAction(rows[0]) : null;
    },

    // { correct: CodeAction | null, improve: CodeAction | null }
    async findByReview(reviewId) {
      const result = Object.fromEntries(CODE_ACTIONS.map((action) => [action, null]));
      const { rows } = await db.execute({ sql: 'SELECT * FROM code_actions WHERE review_id = ?', args: [reviewId] });
      for (const row of rows) result[row.action] = rowToCodeAction(row);
      return result;
    },
  };
}
