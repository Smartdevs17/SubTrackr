import { advanceBillingDate } from '../billingDate';
import { BillingCycle } from '../../types/subscription';

describe('advanceBillingDate', () => {
  it('adds 7 days for weekly cycles', () => {
    const start = new Date(2026, 4, 1, 10, 0, 0); // May 1, 2026
    const next = advanceBillingDate(start, BillingCycle.WEEKLY);
    expect(next).toEqual(new Date(2026, 4, 8, 10, 0, 0));
  });

  it('advances one month and preserves time for monthly cycles', () => {
    const start = new Date(2026, 4, 1, 10, 0, 0);
    const next = advanceBillingDate(start, BillingCycle.MONTHLY);
    expect(next).toEqual(new Date(2026, 5, 1, 10, 0, 0));
  });

  it('rolls last-of-month to month end for monthly cycles', () => {
    const start = new Date(2026, 0, 31, 10, 0, 0); // Jan 31, 2026
    const next = advanceBillingDate(start, BillingCycle.MONTHLY);
    expect(next).toEqual(new Date(2026, 1, 28, 10, 0, 0));
  });

  it('rolls leap-day to February 28 on a non-leap year for yearly cycles', () => {
    const start = new Date(2024, 1, 29, 10, 0, 0); // Feb 29, 2024
    const next = advanceBillingDate(start, BillingCycle.YEARLY);
    expect(next).toEqual(new Date(2025, 1, 28, 10, 0, 0));
  });

  it('uses monthly fallback for custom billing cycles', () => {
    const start = new Date(2026, 2, 31, 10, 0, 0); // Mar 31, 2026
    const next = advanceBillingDate(start, BillingCycle.CUSTOM);
    expect(next).toEqual(new Date(2026, 3, 30, 10, 0, 0));
  });
});
