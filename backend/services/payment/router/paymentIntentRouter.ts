/**
 * Payment Router (HTTP) – payment intents and charge endpoints.
 *
 * Routes:
 *   POST /payments/charge
 *   POST /payments/intents
 *   GET  /payments/intents/:id
 *   POST /payments/intents/:id/cancel
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1716
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1717
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  PaymentController,
  paymentController as defaultController,
} from '../controller/paymentController';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => void;

function wrap(fn: (req: Request, res: Response) => void | Promise<void>): AsyncHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function createPaymentRouter(controller: PaymentController = defaultController): Router {
  const router = Router();

  router.post('/charge', wrap((req, res) => controller.charge(req, res)));
  router.post('/intents', wrap((req, res) => controller.createIntent(req, res)));
  router.get('/intents/:id', wrap((req, res) => controller.getIntent(req, res)));
  router.post('/intents/:id/cancel', wrap((req, res) => controller.cancelIntent(req, res)));

  return router;
}

export default createPaymentRouter;
