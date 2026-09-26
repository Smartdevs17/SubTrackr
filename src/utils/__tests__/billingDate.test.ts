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
  });

  describe('alignBillingToDay', () => {
    it('should align to the 1st of the month', () => {
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

  describe('calculateNextBillingDate', () => {
    it('should calculate next monthly billing with alignment', () => {
      const currentDate = new Date('2024-01-10T10:00:00Z');
      const result = calculateNextBillingDate(currentDate, BillingCycle.MONTHLY, 15);
      expect(result.getUTCDate()).toBe(15);
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it('should calculate next yearly billing with alignment', () => {
      const currentDate = new Date('2024-01-10T10:00:00Z');
      const result = calculateNextBillingDate(currentDate, BillingCycle.YEARLY, 20);
      expect(result.getUTCDate()).toBe(20);
      expect(result.getUTCFullYear()).toBe(2025);
    });

    it('should not apply alignment for weekly billing', () => {
      const currentDate = new Date('2024-01-10T10:00:00Z');
      const result = calculateNextBillingDate(currentDate, BillingCycle.WEEKLY, 15);
      // Should be 7 days later, not aligned to the 15th
      expect(result.toISOString()).toBe('2024-01-17T10:00:00.000Z');
    });

    it('should work without alignment parameter', () => {
      const currentDate = new Date('2024-01-15T10:00:00Z');
      const result = calculateNextBillingDate(currentDate, BillingCycle.MONTHLY);
      expect(result.toISOString()).toBe('2024-02-15T10:00:00.000Z');
    });

    it('should handle alignment across year boundary', () => {
      const currentDate = new Date('2024-12-10T10:00:00Z');
      const result = calculateNextBillingDate(currentDate, BillingCycle.MONTHLY, 5);
      expect(result.getUTCDate()).toBe(5);
      expect(result.getUTCMonth()).toBe(0); // January
      expect(result.getUTCFullYear()).toBe(2025);
    });

    it('should handle alignment to last day of month', () => {
      const currentDate = new Date('2024-01-15T10:00:00Z');
      const result = calculateNextBillingDate(currentDate, BillingCycle.MONTHLY, 31);
      // February has 29 days in 2024 (leap year)
      expect(result.getUTCDate()).toBe(29);
      expect(result.getUTCMonth()).toBe(1); // February
    });
  });
});
