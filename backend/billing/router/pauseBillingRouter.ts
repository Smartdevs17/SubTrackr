/**
 * Pause / resume billing router (Issue #786).
 *
 * Routes:
 *   POST /subscriptions/:id/pause
 *   POST /subscriptions/:id/resume
 *   GET  /subscriptions/:id/pause/preview
 *   GET  /subscriptions/:id/pause/history
 *   GET  /subscriptions/:id/pause/notifications
 *   GET  /pause/analytics
 *   PUT  /pause/limits
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  PauseBillingController,
  pauseBillingController as defaultController,
} from '../controller/pauseBillingController';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => void;

function wrap(fn: (req: Request, res: Response) => void): AsyncHandler {
  return (req, res, next) => {
    try {
      fn(req, res);
    } catch (err) {
      next(err);
    }
  };
}

export function createPauseBillingRouter(
  controller: PauseBillingController = defaultController
): Router {
  const router = Router();

  router.post(
    '/subscriptions/:id/pause',
    wrap((req, res) => controller.pause(req, res))
  );

  router.post(
    '/subscriptions/:id/resume',
    wrap((req, res) => controller.resume(req, res))
  );

  router.get(
    '/subscriptions/:id/pause/preview',
    wrap((req, res) => controller.preview(req, res))
  );

  router.get(
    '/subscriptions/:id/pause/history',
    wrap((req, res) => controller.history(req, res))
  );

  router.get(
    '/subscriptions/:id/pause/notifications',
    wrap((req, res) => controller.notifications(req, res))
  );

  router.get(
    '/pause/analytics',
    wrap((req, res) => controller.analytics(req, res))
  );

  router.put(
    '/pause/limits',
    wrap((req, res) => controller.updateLimits(req, res))
  );

  return router;
}

export default createPauseBillingRouter;
