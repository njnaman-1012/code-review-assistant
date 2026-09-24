// Controllers translate HTTP requests into service calls and service
// results into HTTP responses. They contain no business logic.
import { generateHtmlReport, generateMarkdownReport } from '../services/reportService.js';
import { AppError } from '../utils/AppError.js';

export function createReviewController(reviewService, codeActionService) {
  return {
    // POST /api/reviews
    async create(req, res) {
      const review = await reviewService.createReview(req.reviewInput);
      res.status(201).json({ success: true, data: review });
    },

    // POST /api/reviews/:id/correct - "Fix / Correct Code": the complete corrected source file
    async correct(req, res) {
      res.json({ success: true, data: await codeActionService.generate(req.reviewId, 'correct') });
    },

    // POST /api/reviews/:id/improve - "Improve Code": the complete improved source file
    async improve(req, res) {
      res.json({ success: true, data: await codeActionService.generate(req.reviewId, 'improve') });
    },

    // GET /api/reviews?limit=20&offset=0
    async list(req, res) {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      res.json({ success: true, data: await reviewService.listReviews({ limit, offset }) });
    },

    // GET /api/reviews/:id
    async getById(req, res) {
      res.json({ success: true, data: await reviewService.getReview(req.reviewId) });
    },

    // DELETE /api/reviews/:id
    async remove(req, res) {
      await reviewService.deleteReview(req.reviewId);
      res.json({ success: true, data: { id: req.reviewId, deleted: true } });
    },

    // GET /api/reviews/:id/report?format=html|md
    async report(req, res) {
      const format = (req.query.format || 'html').toLowerCase();
      if (!['html', 'md', 'markdown'].includes(format)) {
        throw new AppError('Report format must be "html" or "md".', 400, 'INVALID_FORMAT');
      }
      const review = await reviewService.getReview(req.reviewId);
      const isHtml = format === 'html';
      const filename = `code-review-${review.id}.${isHtml ? 'html' : 'md'}`;

      res.setHeader('Content-Type', isHtml ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(isHtml ? generateHtmlReport(review) : generateMarkdownReport(review));
    },
  };
}
