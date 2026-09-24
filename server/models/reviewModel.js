// Data-access layer for the "reviews" table. All SQL lives here, so the rest
// of the application works with plain JavaScript objects.
import { toJson, fromJson } from '../utils/jsonUtils.js';

// Converts a database row (snake_case, JSON strings) to the API shape.
function rowToReview(row) {
  return {
    id: row.id,
    language: row.language,
    createdAt: row.created_at,
    originalCode: row.original_code,
    summary: row.summary,
    logic: fromJson(row.logic, {}),
    issues: fromJson(row.issues, []),
    issueCount: row.issue_count,
    quality: fromJson(row.quality, {}),
    suggestions: fromJson(row.suggestions, []),
    improvedCode: row.improved_code,
    improvements: fromJson(row.improvement_explanation, {}),
    complexity: fromJson(row.complexity, {}),
    staticAnalysis: fromJson(row.static_analysis, {}),
    comparison: fromJson(row.comparison, null),
    finalSummary: row.final_summary,
    // Which AI provider/model answered is stored for the developer (ai_provider,
    // ai_model columns) but never sent to the public API.
    ai: {
      status: row.ai_status,
      message: row.ai_message,
    },
  };
}

// Lighter shape used by the history list.
function rowToSummary(row) {
  return {
    id: row.id,
    language: row.language,
    summary: row.summary,
    codePreview: row.code_preview,
    issueCount: row.issue_count,
    qualityScore: row.quality_score,
    aiStatus: row.ai_status,
    createdAt: row.created_at,
  };
}

const INSERT_SQL = `
  INSERT INTO reviews (
    language, original_code, summary, logic, issues, issue_count, quality_score,
    suggestions, improved_code, improvement_explanation, complexity, static_analysis,
    comparison, final_summary, quality, ai_status, ai_message, ai_provider, ai_model
  ) VALUES (
    :language, :originalCode, :summary, :logic, :issues, :issueCount, :qualityScore,
    :suggestions, :improvedCode, :improvements, :complexity, :staticAnalysis,
    :comparison, :finalSummary, :quality, :aiStatus, :aiMessage, :aiProvider, :aiModel
  )`;
const LIST_SQL = `
  SELECT id, language, summary, issue_count, quality_score, ai_status, created_at,
         substr(original_code, 1, 160) AS code_preview
  FROM reviews
  ORDER BY created_at DESC, id DESC
  LIMIT ? OFFSET ?`;

export function createReviewModel(db) {
  return {
    async create(review) {
      const result = await db.execute({
        sql: INSERT_SQL,
        args: {
          language: review.language,
          originalCode: review.originalCode,
          summary: review.summary ?? '',
          logic: toJson(review.logic, {}),
          issues: toJson(review.issues, []),
          issueCount: review.issues?.length ?? 0,
          qualityScore: review.quality?.score ?? null,
          suggestions: toJson(review.suggestions, []),
          improvedCode: review.improvedCode ?? '',
          improvements: toJson(review.improvements, {}),
          complexity: toJson(review.complexity, {}),
          staticAnalysis: toJson(review.staticAnalysis, {}),
          comparison: review.comparison ? JSON.stringify(review.comparison) : null,
          finalSummary: review.finalSummary ?? '',
          quality: toJson(review.quality, {}),
          aiStatus: review.ai?.status ?? 'unavailable',
          aiMessage: review.ai?.message ?? null,
          aiProvider: review.ai?.provider ?? null,
          aiModel: review.ai?.model ?? null,
        },
      });
      return this.findById(Number(result.lastInsertRowid));
    },

    async findById(id) {
      const { rows } = await db.execute({ sql: 'SELECT * FROM reviews WHERE id = ?', args: [id] });
      return rows.length ? rowToReview(rows[0]) : null;
    },

    async findAll({ limit = 50, offset = 0 } = {}) {
      const { rows } = await db.execute({ sql: LIST_SQL, args: [limit, offset] });
      return rows.map(rowToSummary);
    },

    async count() {
      const { rows } = await db.execute('SELECT COUNT(*) AS total FROM reviews');
      return rows[0].total;
    },

    // The generated code of the review is deleted in the same batch
    // (hosted databases do not always enforce ON DELETE CASCADE).
    async deleteById(id) {
      const [, deleted] = await db.batch([
        { sql: 'DELETE FROM code_actions WHERE review_id = ?', args: [id] },
        { sql: 'DELETE FROM reviews WHERE id = ?', args: [id] },
      ], 'write');
      return deleted.rowsAffected > 0;
    },
  };
}
