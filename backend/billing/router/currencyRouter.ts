/**
 * Currency Router – multi-currency support for subscriptions.
 *
 * Routes:
 *   GET    /currency/supported                       – list supported currencies
 *   GET    /currency/rates                            – list all exchange rates
 *   POST   /currency/convert                          – convert an amount
 *   POST   /currency/convert/batch                    – batch convert
 *   POST   /currency/rates                            – set/update a rate
 *   POST   /currency/rates/refresh                    – refresh rates from source
 *   PUT    /subscriptions/:id/currency                – set subscription currency
 *   GET    /subscriptions/:id/currency                – get subscription currency
 *   DELETE /subscriptions/:id/currency                – remove subscription currency
 *   POST   /subscriptions/:id/currency/convert-price  – convert price to preferred currency
 *   GET    /currency/analytics                         – currency analytics
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1121
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  CurrencyController,
  currencyController as defaultController,
} from '../controller/currencyController';

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

export function createCurrencyRouter(
  controller: CurrencyController = defaultController,
): Router {
  const router = Router();

  router.get('/currency/supported', wrap((req, res) => controller.supported(req, res)));
  router.get('/currency/rates', wrap((req, res) => controller.rates(req, res)));
  router.post('/currency/convert', wrap((req, res) => controller.convert(req, res)));
  router.post('/currency/convert/batch', wrap((req, res) => controller.batchConvert(req, res)));
  router.post('/currency/rates', wrap((req, res) => controller.setRate(req, res)));
  router.post('/currency/rates/refresh', wrap((req, res) => controller.refreshRates(req, res)));

  router.put('/subscriptions/:id/currency', wrap((req, res) => controller.setSubscriptionCurrency(req, res)));
  router.get('/subscriptions/:id/currency', wrap((req, res) => controller.getSubscriptionCurrency(req, res)));
  router.delete('/subscriptions/:id/currency', wrap((req, res) => controller.removeSubscriptionCurrency(req, res)));
  router.post('/subscriptions/:id/currency/convert-price', wrap((req, res) => controller.convertSubscriptionPrice(req, res)));

  router.get('/currency/analytics', wrap((req, res) => controller.analytics(req, res)));

  return router;
}

export default createCurrencyRouter;
