/**
 * billingCycleMath.ts
 *
 * One place that turns a subscription's price and billing cycle into a
 * comparable per-month figure.
 *
 * This logic was previously duplicated in four places that disagreed with one
 * another, which produced inconsistent spend and MRR figures depending on
 * which screen the user looked at:
 *
 *   - `subscriptionStore` compared raw strings and omitted `annual` entirely,
 *     so an annual plan was billed as a *monthly* one and inflated MRR 12×.
 *   - `analyticsService` and `analyticsSlice` handled `yearly` but not
 *     `annual`.
 *   - Those two used a hard-coded `4.345` weeks/month while
 *     `BILLING_CONVERSIONS.WEEKS_PER_MONTH` is `52 / 12`.
 */

import { BillingCycle } from '../types/subscription';
import { BILLING_CONVERSIONS } from './constants/values';

/** Canonical weeks-per-month used for every weekly normalisation. */
export const WEEKS_PER_MONTH = BILLING_CONVERSIONS.WEEKS_PER_MONTH;

/**
 * Coerces loose input (`'monthly'`, `'Monthly'`, a missing value) into a
 * `BillingCycle`, defaulting to MONTHLY.
 */
export function normalizeBillingCycle(value: unknown): BillingCycle {
  if (typeof value !== 'string') return BillingCycle.MONTHLY;

  const candidate = value.trim().toLowerCase();
  if (candidate === '') return BillingCycle.MONTHLY;

  const known = Object.values(BillingCycle) as string[];
  if (known.includes(candidate)) {
    return candidate as BillingCycle;
  }

  // Tolerate common synonyms used by imports and older records.
  switch (candidate) {
    case 'annually':
    case 'yearly':
    case 'annual':
    case 'year':
      return BillingCycle.YEARLY;
    case 'week':
    case 'weekly':
      return BillingCycle.WEEKLY;
    case 'month':
    case 'monthly':
      return BillingCycle.MONTHLY;
    default:
      return BillingCycle.MONTHLY;
  }
}

/**
 * Monthly equivalent of `price` charged on `cycle`.
 *
 * `yearly` and `annual` are both billed once per year, so both normalise to
 * one twelfth of the quoted price. `weekly` uses the shared weeks-per-month
 * constant so it cannot drift away from the rest of the codebase.
 */
export function monthlyEquivalent(price: number, cycle: unknown): number {
  if (!Number.isFinite(price)) return 0;

  switch (normalizeBillingCycle(cycle)) {
    case BillingCycle.YEARLY:
    case BillingCycle.ANNUAL:
      return price / BILLING_CONVERSIONS.MONTHS_PER_YEAR;
    case BillingCycle.WEEKLY:
      return price * WEEKS_PER_MONTH;
    default:
      return price;
  }
}

/** Yearly equivalent of `price` charged on `cycle`. */
export function yearlyEquivalent(price: number, cycle: unknown): number {
  if (!Number.isFinite(price)) return 0;

  switch (normalizeBillingCycle(cycle)) {
    case BillingCycle.YEARLY:
    case BillingCycle.ANNUAL:
      return price;
    case BillingCycle.WEEKLY:
      return price * BILLING_CONVERSIONS.WEEKS_PER_YEAR;
    default:
      return price * BILLING_CONVERSIONS.MONTHS_PER_YEAR;
  }
}

/** True for cycles billed once per year. */
export function isAnnualCycle(cycle: unknown): boolean {
  const normalized = normalizeBillingCycle(cycle);
  return normalized === BillingCycle.YEARLY || normalized === BillingCycle.ANNUAL;
}
