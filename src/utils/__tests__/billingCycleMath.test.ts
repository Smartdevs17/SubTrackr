/**
 * Tests for billingCycleMath — one shared billing-cycle normaliser.
 *
 * @see src/utils/billingCycleMath.ts
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1684
 */

import { BillingCycle } from '../../types/subscription';
import {
  WEEKS_PER_MONTH,
  isAnnualCycle,
  monthlyEquivalent,
  normalizeBillingCycle,
  yearlyEquivalent,
} from '../billingCycleMath';

describe('normalizeBillingCycle', () => {
  it('passes through valid enum values', () => {
    expect(normalizeBillingCycle('monthly')).toBe(BillingCycle.MONTHLY);
    expect(normalizeBillingCycle('yearly')).toBe(BillingCycle.YEARLY);
    expect(normalizeBillingCycle('annual')).toBe(BillingCycle.ANNUAL);
    expect(normalizeBillingCycle('weekly')).toBe(BillingCycle.WEEKLY);
    expect(normalizeBillingCycle('custom')).toBe(BillingCycle.CUSTOM);
  });

  it('is case and whitespace insensitive', () => {
    expect(normalizeBillingCycle('  YEARLY ')).toBe(BillingCycle.YEARLY);
    expect(normalizeBillingCycle('Monthly')).toBe(BillingCycle.MONTHLY);
  });

  it('maps common synonyms', () => {
    expect(normalizeBillingCycle('annually')).toBe(BillingCycle.YEARLY);
    expect(normalizeBillingCycle('year')).toBe(BillingCycle.YEARLY);
    expect(normalizeBillingCycle('month')).toBe(BillingCycle.MONTHLY);
    expect(normalizeBillingCycle('week')).toBe(BillingCycle.WEEKLY);
  });

  it('defaults to monthly for unknown or missing values', () => {
    expect(normalizeBillingCycle('fortnightly')).toBe(BillingCycle.MONTHLY);
    expect(normalizeBillingCycle('')).toBe(BillingCycle.MONTHLY);
    expect(normalizeBillingCycle(undefined)).toBe(BillingCycle.MONTHLY);
    expect(normalizeBillingCycle(null)).toBe(BillingCycle.MONTHLY);
    expect(normalizeBillingCycle(42)).toBe(BillingCycle.MONTHLY);
  });
});

describe('monthlyEquivalent', () => {
  it('leaves monthly prices untouched', () => {
    expect(monthlyEquivalent(10, BillingCycle.MONTHLY)).toBe(10);
  });

  it('divides both annual spellings by twelve', () => {
    // The regression: `annual` fell through to the monthly branch, so a
    // 120/year plan reported 120 MRR instead of 10.
    expect(monthlyEquivalent(120, BillingCycle.YEARLY)).toBe(10);
    expect(monthlyEquivalent(120, BillingCycle.ANNUAL)).toBe(10);
    expect(monthlyEquivalent(120, 'annual')).toBe(10);
  });

  it('multiplies weekly prices by the shared weeks-per-month constant', () => {
    expect(monthlyEquivalent(10, BillingCycle.WEEKLY)).toBeCloseTo(10 * WEEKS_PER_MONTH, 10);
  });

  it('uses 52/12 for weeks per month so it cannot drift from BILLING_CONVERSIONS', () => {
    expect(WEEKS_PER_MONTH).toBe(52 / 12);
    // The old hard-coded value was 4.345, which differs from 52/12.
    expect(WEEKS_PER_MONTH).not.toBe(4.345);
  });

  it('maps non-finite prices to zero', () => {
    expect(monthlyEquivalent(Number.NaN, BillingCycle.MONTHLY)).toBe(0);
    expect(monthlyEquivalent(Number.POSITIVE_INFINITY, BillingCycle.YEARLY)).toBe(0);
  });
});

describe('yearlyEquivalent', () => {
  it('leaves annual prices untouched', () => {
    expect(yearlyEquivalent(120, BillingCycle.YEARLY)).toBe(120);
    expect(yearlyEquivalent(120, BillingCycle.ANNUAL)).toBe(120);
  });

  it('multiplies monthly prices by twelve', () => {
    expect(yearlyEquivalent(10, BillingCycle.MONTHLY)).toBe(120);
  });

  it('multiplies weekly prices by fifty-two', () => {
    expect(yearlyEquivalent(10, BillingCycle.WEEKLY)).toBe(520);
  });
});

describe('isAnnualCycle', () => {
  it('recognises both annual spellings', () => {
    expect(isAnnualCycle(BillingCycle.YEARLY)).toBe(true);
    expect(isAnnualCycle(BillingCycle.ANNUAL)).toBe(true);
    expect(isAnnualCycle('annual')).toBe(true);
  });

  it('rejects non-annual cycles', () => {
    expect(isAnnualCycle(BillingCycle.MONTHLY)).toBe(false);
    expect(isAnnualCycle(BillingCycle.WEEKLY)).toBe(false);
    expect(isAnnualCycle(undefined)).toBe(false);
  });
});
