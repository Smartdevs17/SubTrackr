import { BillingCycle } from '../../types/subscription';
import {
  advanceBillingDate,
  alignBillingToDay,
  calculateNextBillingDate,
} from '../billingDate';

describe('billingDate utilities', () => {
  describe('advanceBillingDate', () => {
    it('should advance weekly billing by 7 days', () => {
      const startDate = new Date('2024-01-15T10:00:00Z');
      const result = advanceBillingDate(startDate, BillingCycle.WEEKLY);
      expect(result.toISOString()).toBe('2024-01-22T10:00:00.000Z');
    });

    it('should advance monthly billing by 1 month', () => {
      const startDate = new Date('2024-01-15T10:00:00Z');
      const result = advanceBillingDate(startDate, BillingCycle.MONTHLY);
      expect(result.toISOString()).toBe('2024-02-15T10:00:00.000Z');
    });

    it('should advance yearly billing by 1 year', () => {
      const startDate = new Date('2024-01-15T10:00:00Z');
      const result = advanceBillingDate(startDate, BillingCycle.YEARLY);
      expect(result.toISOString()).toBe('2025-01-15T10:00:00.000Z');
    });

    it('should handle custom billing cycle as monthly', () => {
      const startDate = new Date('2024-01-15T10:00:00Z');
      const result = advanceBillingDate(startDate, BillingCycle.CUSTOM);
      expect(result.toISOString()).toBe('2024-02-15T10:00:00.000Z');
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
  });

  describe('alignBillingToDay', () => {
    it('should align to the 1st of the next month if 1st is before current day', () => {
      const baseDate = new Date('2024-01-15T10:00:00Z');
      const result = alignBillingToDay(baseDate, 1);
      expect(result.getUTCDate()).toBe(1);
      expect(result.getUTCMonth()).toBe(1); // February, since 1st is before 15th
    });

    it('should align to the 15th of the current month', () => {
      const baseDate = new Date('2024-01-10T10:00:00Z');
      const result = alignBillingToDay(baseDate, 15);
      expect(result.getUTCDate()).toBe(15);
      expect(result.getUTCMonth()).toBe(0); // January
    });

    it('should move to next month if target day is before current day', () => {
      const baseDate = new Date('2024-01-20T10:00:00Z');
      const result = alignBillingToDay(baseDate, 10);
      expect(result.getUTCDate()).toBe(10);
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it('should handle 31st in a month with 30 days', () => {
      const baseDate = new Date('2024-04-15T10:00:00Z'); // April has 30 days
      const result = alignBillingToDay(baseDate, 31);
      expect(result.getUTCDate()).toBe(30); // Last day of April
      expect(result.getUTCMonth()).toBe(3); // April
    });

    it('should handle 31st in February (leap year)', () => {
      const baseDate = new Date('2024-02-15T10:00:00Z'); // 2024 is a leap year
      const result = alignBillingToDay(baseDate, 31);
      expect(result.getUTCDate()).toBe(29); // Last day of February in leap year
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it('should handle 31st in February (non-leap year)', () => {
      const baseDate = new Date('2023-02-15T10:00:00Z'); // 2023 is not a leap year
      const result = alignBillingToDay(baseDate, 31);
      expect(result.getUTCDate()).toBe(28); // Last day of February
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it('should return original date if dayOfMonth is invalid (0)', () => {
      const baseDate = new Date('2024-01-15T10:00:00Z');
      const result = alignBillingToDay(baseDate, 0);
      expect(result.getTime()).toBe(baseDate.getTime());
    });

    it('should return original date if dayOfMonth is invalid (32)', () => {
      const baseDate = new Date('2024-01-15T10:00:00Z');
      const result = alignBillingToDay(baseDate, 32);
      expect(result.getTime()).toBe(baseDate.getTime());
    });

    it('should return original date if dayOfMonth is undefined', () => {
      const baseDate = new Date('2024-01-15T10:00:00Z');
      const result = alignBillingToDay(baseDate, undefined as any);
      expect(result.getTime()).toBe(baseDate.getTime());
    });
  });

  it('advances one full year for annual cycles', () => {
    const start = new Date(2026, 8, 15, 12, 0, 0);
    const next = advanceBillingDate(start, BillingCycle.ANNUAL);
    expect(next).toEqual(new Date(2027, 8, 15, 12, 0, 0));
  });

  it('uses monthly fallback for custom billing cycles', () => {
    const start = new Date(2026, 2, 31, 10, 0, 0); // Mar 31, 2026
    const next = advanceBillingDate(start, BillingCycle.CUSTOM);
    expect(next).toEqual(new Date(2026, 3, 30, 10, 0, 0));
  });
});
