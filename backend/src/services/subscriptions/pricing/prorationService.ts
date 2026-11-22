/**
 * Proration Service — calculates billing adjustments when a plan changes
 * mid-period.
 *
 * The service is pure: it performs no I/O and can be unit-tested against
 * deterministic inputs. Persistence and event emission are the caller's
 * responsibility.
 *
 * Algorithm:
 *   1. Measure how much of the current period has been consumed.
 *   2. Credit the unused portion of the old plan.
 *   3. Charge for the remaining days on the new plan.
 *   4. Report the net amount the subscriber owes (or is owed).
 */

import { createPiiSafeLogger } from '../../../utils/logger';
import { PricingError } from './errors';
import { metrics, MetricName } from '../observability';
import type { ProrationInput, ProrationResult } from './types';

const logger = createPiiSafeLogger('subscriptions.pricing.proration');

export class ProrationService {
  /**
   * Calculate the billing adjustment for a mid-period plan change.
   *
   * @throws {PricingError} when inputs are invalid.
   */
  calculate(input: ProrationInput): ProrationResult {
    this.validate(input);

    const changeAt = input.changeAt ?? Date.now();
    const totalMs = input.periodEnd - input.periodStart;
    const usedMs = changeAt - input.periodStart;
    const remainingMs = input.periodEnd - changeAt;

    if (remainingMs < 0) {
      throw PricingError.prorationFailed(
        input.subscriptionId,
        'changeAt is after the period end',
      );
    }

    const totalDays = Math.round(totalMs / 86_400_000);
    const usedDays = Math.round(usedMs / 86_400_000);
    const remainingDays = totalDays - usedDays;

    const dailyCurrent = input.currentPrice / (totalDays || 1);
    const dailyNew = input.newPrice / (totalDays || 1);

    const unusedCredit = round2(dailyCurrent * remainingDays);
    const newPlanCharge = round2(dailyNew * remainingDays);
    const netAmount = round2(newPlanCharge - unusedCredit);

    logger.info('pricing.proration.calculated', {
      subscriptionId: input.subscriptionId,
      usedDays,
      remainingDays,
      unusedCredit,
      newPlanCharge,
      netAmount,
    });

    metrics.increment(MetricName.PRICING_PRORATION);

    return {
      subscriptionId: input.subscriptionId,
      currency: input.currency,
      unusedCredit,
      newPlanCharge,
      netAmount,
      proratedDays: remainingDays,
      totalPeriodDays: totalDays,
    };
  }

  private validate(input: ProrationInput): void {
    if (!input.subscriptionId) {
      throw PricingError.invalidInput('subscriptionId', 'required');
    }
    if (input.currentPrice < 0) {
      throw PricingError.invalidInput('currentPrice', 'must be >= 0');
    }
    if (input.newPrice < 0) {
      throw PricingError.invalidInput('newPrice', 'must be >= 0');
    }
    if (input.periodEnd <= input.periodStart) {
      throw PricingError.prorationFailed(input.subscriptionId, 'periodEnd must be after periodStart');
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const prorationService = new ProrationService();
