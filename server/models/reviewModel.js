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

export function createReviewModel(db) {
  const insertStatement = db.prepare(`
    INSERT INTO reviews (
      language, original_code, summary, logic, issues, issue_count, quality_score,
      suggestions, improved_code, improvement_explanation, complexity, static_analysis,
      comparison, final_summary, quality, ai_status, ai_message, ai_provider, ai_model
    ) VALUES (
      @language, @originalCode, @summary, @logic, @issues, @issueCount, @qualityScore,
      @suggestions, @improvedCode, @improvements, @complexity, @staticAnalysis,
      @comparison, @finalSummary, @quality, @aiStatus, @aiMessage, @aiProvider, @aiModel
    )
  `);
  const findByIdStatement = db.prepare('SELECT * FROM reviews WHERE id = ?');
  const listStatement = db.prepare(`
    SELECT id, language, summary, issue_count, quality_score, ai_status, created_at,
           substr(original_code, 1, 160) AS code_preview
    FROM reviews
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `);
  const countStatement = db.prepare('SELECT COUNT(*) AS total FROM reviews');
  const deleteStatement = db.prepare('DELETE FROM reviews WHERE id = ?');

  return {
    create(review) {
      const result = insertStatement.run({
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
      });
      return this.findById(Number(result.lastInsertRowid));
    },

    findById(id) {
      const row = findByIdStatement.get(id);
      return row ? rowToReview(row) : null;
    },

    findAll({ limit = 50, offset = 0 } = {}) {
      return listStatement.all(limit, offset).map(rowToSummary);
    },

    count() {
      return countStatement.get().total;
    },

    deleteById(id) {
      return deleteStatement.run(id).changes > 0;
    },
  };
}
