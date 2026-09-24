import { Router } from 'express';
import { createReviewValidator, validateIdParam } from '../middleware/validateReviewRequest.js';

export function createReviewRoutes({ controller, reviewLimiter, codeActionLimiter, limits }) {
  const router = Router();
  const validateReview = createReviewValidator(limits);

  router.post('/', reviewLimiter, validateReview, controller.create);
  router.get('/', controller.list);
  router.get('/:id', validateIdParam, controller.getById);
  router.delete('/:id', validateIdParam, controller.remove);
  router.get('/:id/report', validateIdParam, controller.report);
  router.post('/:id/correct', validateIdParam, codeActionLimiter, controller.correct);
  router.post('/:id/improve', validateIdParam, codeActionLimiter, controller.improve);

  return router;
}
