/**
 * Payment Controller – payment intents + charge entry point.
 *
 * Routes:
 *   POST /payments/charge              – route a charge through gateways
 *   POST /payments/intents             – create a payment intent
 *   GET  /payments/intents/:id         – fetch a payment intent
 *   POST /payments/intents/:id/cancel  – cancel a payment intent
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1716
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1717
 */

import type { Request, Response } from 'express';
import { ok, fail, type ApiResponse } from '../../shared/apiResponse';
import { PaymentError, PaymentErrorCode } from '../errors';
import { paymentIntentService as defaultIntentService, PaymentIntentService } from '../domain/paymentIntentService';
import { paymentRouter as defaultRouter } from '../domain/PaymentRouter';
import { AssetNotAllowedError } from '../domain/AssetPolicyService';
import type { PaymentRequest } from '../interfaces';

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

export class PaymentController {
  constructor(
    private readonly intentService: PaymentIntentService = defaultIntentService,
    private readonly router = defaultRouter,
  ) {}

  /** POST /payments/charge */
  async charge(req: Request, res: Response): Promise<void> {
    const requestId = requestIdFrom(req);
    const body = req.body as PaymentRequest;

    if (!body?.amount || !body?.currency || !body?.customerId || !body?.paymentMethodId) {
      send(res, fail('VALIDATION_ERROR', 'amount, currency, customerId and paymentMethodId are required', requestId));
      return;
    }

    try {
      const result = await this.router.charge(body);
      send(res, ok(result, requestId));
    } catch (err) {
      if (err instanceof AssetNotAllowedError) {
        send(res, fail(PaymentErrorCode.ASSET_NOT_ALLOWED, err.message, requestId), 400);
        return;
      }
      if (err instanceof PaymentError) {
        send(res, fail(err.code, err.message, requestId), 400);
        return;
      }
      send(res, fail('PAYMENT_GATEWAY_ERROR', (err as Error).message, requestId), 502);
    }
  }

  /** POST /payments/intents */
  async createIntent(req: Request, res: Response): Promise<void> {
    const requestId = requestIdFrom(req);
    const body = req.body as {
      merchantId?: string;
      subscriberId?: string;
      subscriptionId?: string;
      amount?: number | string;
      asset?: string;
      issuer?: string;
      chain?: 'stellar' | 'evm' | 'fiat';
      unsignedXdr?: string;
      ttlSeconds?: number;
      requiredConfirmations?: number;
      metadata?: Record<string, any>;
    };

    if (!body?.merchantId || !body?.subscriberId || body?.amount === undefined || !body?.asset) {
      send(
        res,
        fail('VALIDATION_ERROR', 'merchantId, subscriberId, amount and asset are required', requestId),
      );
      return;
    }

    if (body.ttlSeconds !== undefined && (typeof body.ttlSeconds !== 'number' || body.ttlSeconds <= 0)) {
      send(res, fail('VALIDATION_ERROR', 'ttlSeconds must be a positive number', requestId));
      return;
    }

    try {
      const intent = await this.intentService.create({
        merchantId: body.merchantId,
        subscriberId: body.subscriberId,
        subscriptionId: body.subscriptionId,
        amount: body.amount,
        asset: body.asset,
        issuer: body.issuer,
        chain: body.chain ?? 'stellar',
        unsignedXdr: body.unsignedXdr,
        ttlSeconds: body.ttlSeconds,
        requiredConfirmations: body.requiredConfirmations,
        metadata: body.metadata,
      });
      send(res, ok(intent, requestId), 201);
    } catch (err) {
      if (err instanceof AssetNotAllowedError) {
        send(res, fail(PaymentErrorCode.ASSET_NOT_ALLOWED, err.message, requestId), 400);
        return;
      }
      send(res, fail('INTERNAL_SERVER_ERROR', (err as Error).message, requestId), 500);
    }
  }

  /** GET /payments/intents/:id */
  async getIntent(req: Request, res: Response): Promise<void> {
    const requestId = requestIdFrom(req);
    const id = req.params.id;

    if (!id) {
      send(res, fail('VALIDATION_ERROR', 'intent id is required', requestId));
      return;
    }

    try {
      const intent = await this.intentService.get(id);
      if (!intent) {
        send(res, fail('NOT_FOUND', `Payment intent ${id} not found`, requestId), 404);
        return;
      }
      send(res, ok(intent, requestId));
    } catch (err) {
      send(res, fail('INTERNAL_SERVER_ERROR', (err as Error).message, requestId), 500);
    }
  }

  /** POST /payments/intents/:id/cancel */
  async cancelIntent(req: Request, res: Response): Promise<void> {
    const requestId = requestIdFrom(req);
    const id = req.params.id;

    if (!id) {
      send(res, fail('VALIDATION_ERROR', 'intent id is required', requestId));
      return;
    }

    try {
      const intent = await this.intentService.cancel(id);
      send(res, ok(intent, requestId), 201);
    } catch (err) {
      if ((err as Error).message?.includes('not found')) {
        send(res, fail('NOT_FOUND', (err as Error).message, requestId), 404);
        return;
      }
      send(res, fail('INTERNAL_SERVER_ERROR', (err as Error).message, requestId), 500);
    }
  }
}

export const paymentController = new PaymentController();
export default paymentController;
