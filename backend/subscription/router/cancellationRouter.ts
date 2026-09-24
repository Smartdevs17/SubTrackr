/**
 * Cancellation Router – subscription cancellation flow with retention hooks.
 *
 * Routes:
 *   POST /subscriptions/:id/cancel               – initiate cancellation
 *   POST /subscriptions/:id/cancel/revert         – revert pending cancellation
 *   POST /subscriptions/:id/cancel/feedback       – submit cancellation feedback
 *   POST /retention/:offerId/accept               – accept retention offer
 *   POST /retention/:offerId/decline               – decline retention offer
 *   GET  /subscriptions/:id/cancel/status         – get cancellation status
 *   GET  /subscriptions/:id/cancel/history         – cancellation history
 *   GET  /cancellation/analytics                    – aggregated analytics
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1119
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  CancellationController,
  cancellationController as defaultController,
} from '../controller/cancellationController';

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

export function createCancellationRouter(
  controller: CancellationController = defaultController,
): Router {
  const router = Router();

  router.post(
    '/subscriptions/:id/cancel',
    wrap((req, res) => controller.cancel(req, res)),
  );

  router.post(
    '/subscriptions/:id/cancel/revert',
    wrap((req, res) => controller.revert(req, res)),
  );

  router.post(
    '/subscriptions/:id/cancel/feedback',
    wrap((req, res) => controller.feedback(req, res)),
  );

  router.post(
    '/retention/:offerId/accept',
    wrap((req, res) => controller.acceptOffer(req, res)),
  );

  router.post(
    '/retention/:offerId/decline',
    wrap((req, res) => controller.declineOffer(req, res)),
  );

  router.get(
    '/subscriptions/:id/cancel/status',
    wrap((req, res) => controller.status(req, res)),
  );

  router.get(
    '/subscriptions/:id/cancel/history',
    wrap((req, res) => controller.history(req, res)),
  );

  router.get(
    '/cancellation/analytics',
    wrap((req, res) => controller.analytics(req, res)),
  );

  return router;
}

export default createCancellationRouter;
