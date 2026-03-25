import {
  formatCurrency,
  formatRelativeDate,
  formatBillingCycle,
  formatCategory
} from '../formatting';
import { SubscriptionCategory, BillingCycle } from '../../types/subscription';

describe('Formatting Utilities', () => {
  describe('formatCurrency', () => {
    it('formats USD correctly', () => {
      expect(formatCurrency(19.99)).toBe('$19.99');
      expect(formatCurrency(0)).toBe('$0.00');
    });

    it('formats other currencies correctly', () => {
      expect(formatCurrency(19.99, 'EUR').replace(/\s/g, ' ')).toContain('19.99');
      expect(formatCurrency(19.99, 'GBP')).toContain('£19.99');
    });

    it('handles negative values correctly', () => {
      expect(formatCurrency(-10.50)).toBe('-$10.50');
    });
  });

  describe('formatRelativeDate', () => {
    beforeAll(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    it('returns "Today" for current date', () => {
      expect(formatRelativeDate(new Date('2024-01-15T15:00:00Z'))).toBe('Today');
    });

    it('returns "Yesterday" for previous day', () => {
      expect(formatRelativeDate(new Date('2024-01-14T10:00:00Z'))).toBe('Yesterday');
    });

    it('returns "Tomorrow" for next day', () => {
      expect(formatRelativeDate(new Date('2024-01-16T10:00:00Z'))).toBe('Tomorrow');
    });

    it('formats days ago correctly', () => {
      expect(formatRelativeDate(new Date('2024-01-10T10:00:00Z'))).toBe('5 days ago');
    });

    it('formats future days correctly', () => {
      expect(formatRelativeDate(new Date('2024-01-20T10:00:00Z'))).toBe('In 5 days');
    });
  });

  describe('formatBillingCycle', () => {
    it('capitalizes monthly correctly', () => {
      expect(formatBillingCycle(BillingCycle.MONTHLY)).toBe('Monthly');
    });

    it('capitalizes yearly correctly', () => {
      expect(formatBillingCycle(BillingCycle.YEARLY)).toBe('Yearly');
    });

    it('capitalizes weekly correctly', () => {
      expect(formatBillingCycle(BillingCycle.WEEKLY)).toBe('Weekly');
    });

    it('capitalizes custom correctly', () => {
      expect(formatBillingCycle(BillingCycle.CUSTOM)).toBe('Custom');
    });
  });

  describe('formatCategory', () => {
    it('capitalizes streaming correctly', () => {
      expect(formatCategory(SubscriptionCategory.STREAMING)).toBe('Streaming');
    });

    it('capitalizes software correctly', () => {
      expect(formatCategory(SubscriptionCategory.SOFTWARE)).toBe('Software');
    });

    it('capitalizes other enum values correctly', () => {
      expect(formatCategory(SubscriptionCategory.FITNESS)).toBe('Fitness');
      expect(formatCategory(SubscriptionCategory.EDUCATION)).toBe('Education');
    });
  });
});
