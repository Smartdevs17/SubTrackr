/**
 * PaymentSplitService – cross-account payment splitting (Issue #1720).
 *
 * Splits a single payment across multiple destination accounts by percentage.
 *
 * Rules:
 *   - At least two splits are required.
 *   - Each split percentage must be > 0.
 *   - Percentages must sum exactly to 100 (within a 0.01 floating-point tolerance).
 *   - Each split is executed as an independent charge via the payment router.
 *   - Every split result is recorded in the returned SplitPaymentResult.
 *   - If any individual charge fails the service still attempts the remaining
 *     splits, then surfaces per-split errors in the response.
 */

import { logger } from '../../shared/logging';
import type { IPaymentRouter, PaymentRequest, PaymentResult } from '../interfaces';
import { PaymentError, PaymentErrorCode } from '../errors';

// ─── Public types ─────────────────────────────────────────────────────────────

/** A single destination account and the percentage of the total it should receive. */
export interface PaymentSplitEntry {
  /** Destination account / customer identifier understood by the payment gateway. */
  destinationAccountId: string;
  /**
   * Percentage of the total amount to charge this account, expressed as a
   * number between 0 (exclusive) and 100 (inclusive), e.g. `30` = 30 %.
   * All percentages in a split request must sum to exactly 100.
   */
  percentage: number;
}

/** The request payload for a split payment. */
export interface SplitPaymentRequest {
  /** Total amount to distribute across all destinations, in the smallest currency unit. */
  amount: number;
  currency: string;
  /** Idempotency key for the *overall* split operation. Per-split keys are derived from this. */
  idempotencyKey: string;
  /** Optional payment method ID forwarded to each per-split charge. */
  paymentMethodId?: string;
  /** Optional chain / gateway routing hints forwarded to each charge. */
  chainType?: 'evm' | 'stellar' | 'fiat';
  chainId?: number;
  metadata?: Record<string, string>;
  /** The splits that describe how to distribute the payment. */
  splits: PaymentSplitEntry[];
}

/** The result of one individual split charge. */
export interface SplitEntryResult {
  destinationAccountId: string;
  percentage: number;
  amount: number;
  status: 'succeeded' | 'failed' | 'pending';
  chargeId?: string;
  gatewayUsed?: string;
  errorMessage?: string;
  processedAt?: string;
}

/** The aggregate result returned after executing all splits. */
export interface SplitPaymentResult {
  /** True only when every individual split succeeded. */
  allSucceeded: boolean;
  totalAmount: number;
  currency: string;
  splits: SplitEntryResult[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PERCENTAGE_SUM_TOLERANCE = 0.01;

/**
 * Validates that the splits list is well-formed and sums to 100 %.
 * Throws a {@link PaymentError} with code SPLIT_VALIDATION_ERROR on failure.
 */
export function validateSplits(splits: PaymentSplitEntry[]): void {
  if (!Array.isArray(splits) || splits.length < 2) {
    throw new PaymentError(
      PaymentErrorCode.SPLIT_VALIDATION_ERROR,
      'At least two split entries are required',
      { required: '2', received: String(splits?.length ?? 0) },
    );
  }

  for (const [i, entry] of splits.entries()) {
    if (typeof entry.destinationAccountId !== 'string' || !entry.destinationAccountId.trim()) {
      throw new PaymentError(
        PaymentErrorCode.SPLIT_VALIDATION_ERROR,
        `Split entry at index ${i} is missing a valid destinationAccountId`,
        { index: String(i) },
      );
    }
    if (typeof entry.percentage !== 'number' || !Number.isFinite(entry.percentage) || entry.percentage <= 0) {
      throw new PaymentError(
        PaymentErrorCode.SPLIT_VALIDATION_ERROR,
        `Split entry at index ${i} has an invalid percentage: must be a positive finite number`,
        { index: String(i), percentage: String(entry.percentage) },
      );
    }
  }

  const total = splits.reduce((sum, s) => sum + s.percentage, 0);
  if (Math.abs(total - 100) > PERCENTAGE_SUM_TOLERANCE) {
    throw new PaymentError(
      PaymentErrorCode.SPLIT_VALIDATION_ERROR,
      `Split percentages must sum to 100 but got ${total.toFixed(4)}`,
      { sum: total.toFixed(4) },
    );
  }
}

/**
 * Calculates the amount for one split, rounding to 2 decimal places.
 * The last split in the list receives whatever is left over to avoid
 * floating-point drift accumulating across the full amount.
 */
export function splitAmount(totalAmount: number, percentage: number, _isLast: boolean, alreadyAllocated: number): number {
  if (_isLast) {
    const remaining = Math.round((totalAmount - alreadyAllocated) * 100) / 100;
    return remaining > 0 ? remaining : 0;
  }
  return Math.round(totalAmount * (percentage / 100) * 100) / 100;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class PaymentSplitService {
  constructor(private readonly router: IPaymentRouter) {}

  /**
   * Executes a split payment, charging each destination account for its share.
   *
   * Individual gateway errors do not abort the remaining charges; each split
   * result carries its own status. The caller should inspect `allSucceeded` and
   * the per-entry `errorMessage` fields.
   */
  async split(request: SplitPaymentRequest): Promise<SplitPaymentResult> {
    validateSplits(request.splits);

    const results: SplitEntryResult[] = [];
    let allocated = 0;

    for (const [index, entry] of request.splits.entries()) {
      const isLast = index === request.splits.length - 1;
      const chargeAmount = splitAmount(request.amount, entry.percentage, isLast, allocated);

      if (!isLast) {
        allocated = Math.round((allocated + chargeAmount) * 100) / 100;
      }

      const chargeRequest: PaymentRequest = {
        amount: chargeAmount,
        currency: request.currency,
        customerId: entry.destinationAccountId,
        paymentMethodId: request.paymentMethodId ?? '',
        idempotencyKey: `${request.idempotencyKey}:split:${index}`,
        ...(request.chainType !== undefined && { chainType: request.chainType }),
        ...(request.chainId !== undefined && { chainId: request.chainId }),
        ...(request.metadata !== undefined && { metadata: request.metadata }),
      };

      let entryResult: SplitEntryResult;

      try {
        const result: PaymentResult = await this.router.charge(chargeRequest);
        entryResult = {
          destinationAccountId: entry.destinationAccountId,
          percentage: entry.percentage,
          amount: chargeAmount,
          status: result.status,
          chargeId: result.chargeId,
          gatewayUsed: result.gatewayUsed,
          processedAt: result.processedAt,
        };

        logger.info('Split payment entry processed', {
          destinationAccountId: entry.destinationAccountId,
          percentage: entry.percentage,
          amount: chargeAmount,
          status: result.status,
          gatewayUsed: result.gatewayUsed,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        entryResult = {
          destinationAccountId: entry.destinationAccountId,
          percentage: entry.percentage,
          amount: chargeAmount,
          status: 'failed',
          errorMessage: message,
        };

        logger.warn('Split payment entry failed', {
          destinationAccountId: entry.destinationAccountId,
          percentage: entry.percentage,
          amount: chargeAmount,
          error: message,
        });
      }

      results.push(entryResult);
    }

    const allSucceeded = results.every((r) => r.status === 'succeeded');

    return {
      allSucceeded,
      totalAmount: request.amount,
      currency: request.currency,
      splits: results,
    };
  }
}
