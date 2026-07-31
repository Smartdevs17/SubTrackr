/**
 * Issue #776 – Plan comparison / recommendation routes.
 *
 *   POST /plans/compare
 *   POST /plans/recommend
 *   POST /plans/recommendations/track
 *   GET  /plans/comparisons/analytics
 *   POST /plans/comparisons/share
 *   GET  /plans/comparisons/share/:token
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  comparePlansHandler,
  recommendPlansHandler,
  trackRecommendationHandler,
  getAnalyticsHandler,
  shareComparisonHandler,
  resolveShareHandler,
} from '../controller/planComparisonController';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function createPlanComparisonRouter(): Router {
  const router = Router();

  router.post(
    '/plans/compare',
    asyncHandler((req, res) => {
      comparePlansHandler(req, res);
    })
  );

  router.post(
    '/plans/recommend',
    asyncHandler((req, res) => {
      recommendPlansHandler(req, res);
    })
  );

  router.post(
    '/plans/recommendations/track',
    asyncHandler((req, res) => {
      trackRecommendationHandler(req, res);
    })
  );

  router.get(
    '/plans/comparisons/analytics',
    asyncHandler((req, res) => {
      getAnalyticsHandler(req, res);
    })
  );

  router.post(
    '/plans/comparisons/share',
    asyncHandler((req, res) => {
      shareComparisonHandler(req, res);
    })
  );

  router.get(
    '/plans/comparisons/share/:token',
    asyncHandler((req, res) => {
      resolveShareHandler(req, res);
    })
  );

  return router;
}
