import { Router } from 'express';

export function createHealthRoutes(controller) {
  const router = Router();
  router.get('/', controller.check);
  return router;
}
