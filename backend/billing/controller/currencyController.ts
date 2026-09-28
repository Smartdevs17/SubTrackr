/**
 * Currency Controller – multi-currency support for subscriptions.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1121
 */

import type { Request, Response } from 'express';
import { ok, fail, type ApiResponse } from '../../services/shared/apiResponse';
import {
  CurrencyConversionService,
  currencyConversionService as defaultService,
} from '../domain/currencyConversionService';
import type { CurrencyCode } from '../domain/currencyConversionService';

function requestIdFrom(req: Request): string | undefined {
  return (req.headers['x-request-id'] as string) ?? undefined;
}

function send<T>(res: Response, response: ApiResponse<T>, statusOverride?: number): void {
  if (response.success) {
    res.status(statusOverride ?? 200).json(response);
    return;
  }
  res.status(statusOverride ?? 400).json(response);
}

export class CurrencyController {
  constructor(private readonly service: CurrencyConversionService = defaultService) {}

  /** GET /currency/supported */
  supported(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    send(res, ok({
      base: this.service.getBaseCurrency(),
      supported: this.service.getSupportedCurrencies(),
    }, requestId));
  }

  /** GET /currency/rates */
  rates(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const rates = this.service.getAllRates();
    send(res, ok(rates, requestId));
  }

  /** POST /currency/convert */
  convert(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const body = req.body as { amount: number; from: CurrencyCode; to: CurrencyCode };

    if (typeof body.amount !== 'number' || !body.from || !body.to) {
      send(res, fail('VALIDATION_ERROR', 'amount, from, and to are required', requestId));
      return;
    }

    try {
      const result = this.service.convert(body.amount, body.from, body.to);
      send(res, ok(result, requestId));
    } catch (err) {
      send(res, fail('CONVERSION_ERROR', (err as Error).message, requestId));
    }
  }

  /** POST /currency/convert/batch */
  batchConvert(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const body = req.body as Array<{ amount: number; from: CurrencyCode; to: CurrencyCode }>;

    if (!Array.isArray(body)) {
      send(res, fail('VALIDATION_ERROR', 'Body must be an array of conversion items', requestId));
      return;
    }

    const results = this.service.batchConvert(body);
    send(res, ok(results, requestId));
  }

  /** POST /currency/rates */
  setRate(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const body = req.body as { base: CurrencyCode; quote: CurrencyCode; rate: number; source?: string };

    if (!body.base || !body.quote || typeof body.rate !== 'number') {
      send(res, fail('VALIDATION_ERROR', 'base, quote, and rate are required', requestId));
      return;
    }

    try {
      const rate = this.service.setRate(body.base, body.quote, body.rate, Date.now(), body.source);
      send(res, ok(rate, requestId), 201);
    } catch (err) {
      send(res, fail('VALIDATION_ERROR', (err as Error).message, requestId));
    }
  }

  /** PUT /subscriptions/:id/currency */
  setSubscriptionCurrency(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;
    const body = req.body as { currency: CurrencyCode };

    if (!subscriptionId || !body.currency) {
      send(res, fail('VALIDATION_ERROR', 'subscriptionId and currency are required', requestId));
      return;
    }

    try {
      const pref = this.service.setSubscriptionCurrency(subscriptionId, body.currency);
      send(res, ok(pref, requestId));
    } catch (err) {
      send(res, fail('UNSUPPORTED_CURRENCY', (err as Error).message, requestId), 422);
    }
  }

  /** GET /subscriptions/:id/currency */
  getSubscriptionCurrency(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;

    const currency = this.service.getSubscriptionCurrency(subscriptionId);
    send(res, ok({ subscriptionId, currency }, requestId));
  }

  /** DELETE /subscriptions/:id/currency */
  removeSubscriptionCurrency(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;

    const removed = this.service.removeSubscriptionCurrency(subscriptionId);
    send(res, ok({ subscriptionId, removed, currency: this.service.getBaseCurrency() }, requestId));
  }

  /** POST /subscriptions/:id/currency/convert-price */
  convertSubscriptionPrice(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;
    const body = req.body as { price: number; priceCurrency: CurrencyCode };

    if (!subscriptionId || typeof body.price !== 'number' || !body.priceCurrency) {
      send(res, fail('VALIDATION_ERROR', 'subscriptionId, price, and priceCurrency are required', requestId));
      return;
    }

    const result = this.service.convertSubscriptionPrice(body.price, body.priceCurrency, subscriptionId);
    send(res, ok(result, requestId));
  }

  /** POST /currency/rates/refresh */
  async refreshRates(req: Request, res: Response): Promise<void> {
    const requestId = requestIdFrom(req);
    const body = req.body as { fetcher?: string };

    // In production, this would call an external API.
    // For now, we re-seed from fallback rates.
    try {
      const count = await this.service.refreshRates(async (base) => {
        // Simulate an API response — in production this would be a real fetch
        const rates: Record<string, number> = {};
        for (const r of this.service.getAllRates()) {
          if (r.base === base && r.source === 'fallback') {
            rates[r.quote] = r.rate;
          }
        }
        return rates;
      });
      send(res, ok({ refreshed: count }, requestId));
    } catch (err) {
      send(res, fail('RATE_REFRESH_ERROR', (err as Error).message, requestId));
    }
  }

  /** GET /currency/analytics */
  analytics(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const report = this.service.getAnalytics();
    send(res, ok(report, requestId));
  }
}

export const currencyController = new CurrencyController();
