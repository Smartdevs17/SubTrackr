/**
 * PaymentSplitController – handles POST /payments/split (Issue #1720).
 */

import type { Request, Response } from 'express';
import { ok, fail } from '../../shared/apiResponse';
import {
  PaymentSplitService,
  type SplitPaymentRequest,
  type PaymentSplitEntry,
} from '../domain/PaymentSplitService';
import { PaymentError, PaymentErrorCode } from '../errors';
import { paymentRouter } from '../domain/PaymentRouter';

// ─── Singleton ────────────────────────────────────────────────────────────────

export const defaultSplitService = new PaymentSplitService(paymentRouter);

// ─── Controller ──────────────────────────────────────────────────────────────

function requestIdFrom(req: Request): string | undefined {
  return (req.headers['x-request-id'] as string | undefined) ?? undefined;
}

export class PaymentSplitController {
  constructor(private readonly service: PaymentSplitService = defaultSplitService) {}

  /**
   * POST /payments/split
   *
   * Body (JSON):
   * {
   *   amount        : number,          // total amount in smallest unit
   *   currency      : string,          // e.g. "USD", "XLM"
   *   idempotencyKey: string,
   *   paymentMethodId?: string,
   *   chainType?    : "evm" | "stellar" | "fiat",
   *   chainId?      : number,
   *   metadata?     : Record<string, string>,
   *   splits: [
   *     { destinationAccountId: string, percentage: number },
   *     ...
   *   ]
   * }
   */
  async split(req: Request, res: Response): Promise<void> {
    const requestId = requestIdFrom(req);
    const body = req.body as Partial<SplitPaymentRequest & { splits: Partial<PaymentSplitEntry>[] }>;

    // ── Basic structural validation ──────────────────────────────────────────
    if (typeof body.amount !== 'number' || body.amount <= 0) {
      res.status(400).json(fail('VALIDATION_ERROR', 'amount must be a positive number', requestId));
      return;
    }

    if (typeof body.currency !== 'string' || !body.currency.trim()) {
      res.status(400).json(fail('VALIDATION_ERROR', 'currency is required', requestId));
      return;
    }

    if (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim()) {
      res.status(400).json(fail('VALIDATION_ERROR', 'idempotencyKey is required', requestId));
      return;
    }

    if (!Array.isArray(body.splits) || body.splits.length === 0) {
      res.status(400).json(fail('VALIDATION_ERROR', 'splits must be a non-empty array', requestId));
      return;
    }

    // ── Delegate to domain service ───────────────────────────────────────────
    try {
      const result = await this.service.split({
        amount: body.amount,
        currency: body.currency.trim(),
        idempotencyKey: body.idempotencyKey.trim(),
        paymentMethodId: body.paymentMethodId,
        chainType: body.chainType,
        chainId: body.chainId,
        metadata: body.metadata,
        splits: body.splits as PaymentSplitEntry[],
      });

      // Return 207 Multi-Status when at least one split failed but others
      // succeeded; 200 only when everything succeeded.
      const statusCode = result.allSucceeded ? 200 : 207;
      res.status(statusCode).json(ok(result, requestId));
    } catch (err) {
      if (err instanceof PaymentError && err.code === PaymentErrorCode.SPLIT_VALIDATION_ERROR) {
        res.status(422).json(fail('VALIDATION_ERROR', err.message, requestId));
        return;
      }
      if (err instanceof PaymentError) {
        res.status(400).json(fail('PAYMENT_ERROR' as never, err.message, requestId));
        return;
      }
      const message = err instanceof Error ? err.message : 'Internal server error';
      res.status(500).json(fail('INTERNAL_SERVER_ERROR', message, requestId));
    }
  }
}

export const paymentSplitController = new PaymentSplitController();
