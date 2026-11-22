/**
 * Proration Router – subscription upgrade / downgrade endpoints.
 *
 * Routes:
 *   POST   /subscriptions/:id/proration/preview       – preview proration
 *   POST   /subscriptions/:id/proration/apply          – create proration record
 *   PATCH  /subscriptions/:id/proration/:recordId/confirm – confirm & apply
 *   DELETE /subscriptions/:id/proration/:recordId      – cancel proration
 *   GET    /subscriptions/:id/proration/history         – list proration records
 *   GET    /proration/analytics                          – aggregated analytics
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1117
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  ProrationController,
  prorationController as defaultController,
} from '../controller/prorationController';

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

export function createProrationRouter(
  controller: ProrationController = defaultController,
): Router {
  const router = Router();

  router.post(
    '/subscriptions/:id/proration/preview',
    wrap((req, res) => controller.preview(req, res)),
  );

  router.post(
    '/subscriptions/:id/proration/apply',
    wrap((req, res) => controller.apply(req, res)),
  );

  router.patch(
    '/subscriptions/:id/proration/:recordId/confirm',
    wrap((req, res) => controller.confirm(req, res)),
  );

  router.delete(
    '/subscriptions/:id/proration/:recordId',
    wrap((req, res) => controller.cancel(req, res)),
  );

  router.get(
    '/subscriptions/:id/proration/history',
    wrap((req, res) => controller.history(req, res)),
  );

  router.get(
    '/proration/analytics',
    wrap((req, res) => controller.analytics(req, res)),
  );

  return router;
}

export default createProrationRouter;
