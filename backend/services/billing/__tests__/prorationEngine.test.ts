import { BillingCycle } from '../../../../src/types/subscription';
import type { ProrationCalculationRequest } from '../../../../src/types/prorationCalculator';
import {
  ProrationValidationError,
  calculateExactProration,
  calculateNetProration,
} from '../prorationEngine';

describe('exact proration engine', () => {
  const base: ProrationCalculationRequest = {
    subscriptionId: 'sub_exact',
    currentPlanId: 'basic',
    currentPlanName: 'Basic',
    currentPrice: 9.99,
    currentCycle: BillingCycle.MONTHLY,
    newPlanId: 'pro',
    newPlanName: 'Pro',
    newPrice: 19.99,
    newCycle: BillingCycle.MONTHLY,
    cycleStartDate: '2026-09-01T00:00:00Z',
    cycleEndDate: '2026-10-01T00:00:00Z',
    effectiveDate: '2026-09-16T00:00:00Z',
  };

  it('uses the exact remaining fraction of the cycle instead of rounded days', () => {
    const result = calculateExactProration(base);

    expect(result.precision).toBe('day');
    expect(result.cycleTotalHours).toBe(720);
    expect(result.hoursRemaining).toBe(360);
    expect(result.daysRemainingExact).toBe(15);
    expect(result.currentPlan.unusedAmount).toBe(5);
    expect(result.newPlan.proratedAmount).toBe(10);
    expect(result.netProratedAmount).toBe(5);
  });

  it('supports hour granularity with fractional hours', () => {
    const result = calculateExactProration({
      ...base,
      currentPrice: 12,
      newPrice: 24,
      effectiveDate: '2026-09-29T12:00:00Z',
      precision: 'hour',
    });

    expect(result.precision).toBe('hour');
    expect(result.hoursRemaining).toBe(36);
    expect(result.daysRemainingExact).toBe(1.5);
    expect(result.currentPlan.unusedAmount).toBe(0.6);
    expect(result.newPlan.proratedAmount).toBe(1.2);
    expect(result.netProratedAmount).toBe(0.6);
  });

  it('prorates annual plans over 365 days rather than falling back to 30', () => {
    const result = calculateExactProration({
      ...base,
      newCycle: BillingCycle.ANNUAL,
      newPrice: 365,
    });

    expect(result.newPlan.proratedAmount).toBe(15);
  });

  it('clamps an out-of-cycle effective date to the cycle boundaries', () => {
    const before = calculateExactProration({ ...base, effectiveDate: '2026-01-01T00:00:00Z' });
    const after = calculateExactProration({ ...base, effectiveDate: '2027-01-01T00:00:00Z' });

    expect(before.daysRemainingExact).toBe(30);
    expect(after.daysRemainingExact).toBe(0);
  });

  it('returns a credit and negative tax for a downgrade', () => {
    const result = calculateExactProration({
      ...base,
      currentPrice: 19.99,
      newPrice: 9.99,
      config: { includeTax: true, defaultTaxRate: 10 },
    });

    expect(result.mode).toBe('downgrade');
    expect(result.isCredit).toBe(true);
    expect(result.taxAmount).toBeLessThan(0);
    expect(result.totalAmountDue).toBe(0);
    expect(result.transparencySummary.finalAmountToBillOrCredit).toBeLessThan(0);
  });

  it('aggregates sequential adjustments without rounding each step', () => {
    const result = calculateNetProration(base, [
      { oldPrice: 9.99, newPrice: 19.99 },
      { oldPrice: 19.99, newPrice: 29.99 },
    ]);

    expect(result.netAmount).toBe(10);
    expect(result.isCredit).toBe(false);
    expect(result.adjustments).toHaveLength(2);
  });

  it('rejects invalid prices and dates', () => {
    expect(() => calculateExactProration({ ...base, newPrice: -1 })).toThrow(
      ProrationValidationError,
    );
    expect(() =>
      calculateExactProration({ ...base, cycleEndDate: '2026-08-01T00:00:00Z' }),
    ).toThrow('cycleEndDate must be after cycleStartDate');
  });
});
