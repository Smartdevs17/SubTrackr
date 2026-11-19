/**
 * Payment Split Router – cross-account payment splitting (Issue #1720).
 *
 * Routes:
 *   POST /payments/split  – split a payment across multiple destination accounts
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  PaymentSplitController,
  paymentSplitController as defaultController,
} from '../controller/paymentSplitController';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => void;

function wrap(fn: (req: Request, res: Response) => Promise<void>): AsyncHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function createPaymentSplitRouter(
  controller: PaymentSplitController = defaultController,
): Router {
  const router = Router();

  /**
   * POST /payments/split
   *
   * Splits a payment across multiple destination accounts by percentage.
   * Percentages must sum to exactly 100.
   * Returns 200 when all splits succeed, 207 when some fail.
   */
  router.post('/payments/split', wrap((req, res) => controller.split(req, res)));

  return router;
}

export default createPaymentSplitRouter;
