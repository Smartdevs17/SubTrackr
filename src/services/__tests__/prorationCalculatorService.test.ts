/**
 * Unit tests for Proration Calculator Service
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/784
 */

import { BillingCycle } from '../types/subscription';
import {
  calculateProration,
  calculateCycleDays,
  buildProrationAnalytics,
} from '../services/prorationCalculatorService';
import type { ProrationRecord } from '../types/prorationCalculator';

describe('ProrationCalculatorService', () => {
  describe('calculateCycleDays', () => {
    it('calculates 30 days for a 30-day month', () => {
      const start = new Date('2026-01-01').getTime();
      const end = new Date('2026-01-31').getTime();
      expect(calculateCycleDays(start, end)).toBe(30);
    });
  });

  describe('calculateProration', () => {
    it('calculates upgrade proration with 15 days remaining in 30-day cycle', () => {
      const now = new Date('2026-01-16').getTime();
      const start = new Date('2026-01-01').getTime();
      const end = new Date('2026-01-31').getTime();

      const result = calculateProration({
        currentPlanId: 'p1',
        currentPlanName: 'Basic',
        currentPrice: 30,
        currentCycle: BillingCycle.MONTHLY,
        newPlanId: 'p2',
        newPlanName: 'Pro',
        newPrice: 60,
        newCycle: BillingCycle.MONTHLY,
        cycleStartDate: start,
        cycleEndDate: end,
        effectiveDate: now,
      });

      expect(result.mode).toBe('upgrade');
      expect(result.daysRemaining).toBe(15);
      expect(result.currentPlan.unusedAmount).toBe(15); // 15 days * $1/day
      expect(result.newPlan.proratedAmount).toBe(30); // 15 days * $2/day
      expect(result.netProratedAmount).toBe(15); // $30 - $15
      expect(result.isCredit).toBe(false);
      expect(result.breakdown).toHaveLength(2);
      expect(result.explanationText).toContain('credited $15.00 for unused time on Basic');
    });

    it('calculates downgrade proration resulting in credit', () => {
      const now = new Date('2026-01-16').getTime();
      const start = new Date('2026-01-01').getTime();
      const end = new Date('2026-01-31').getTime();

      const result = calculateProration({
        currentPlanId: 'p2',
        currentPlanName: 'Pro',
        currentPrice: 60,
        currentCycle: BillingCycle.MONTHLY,
        newPlanId: 'p1',
        newPlanName: 'Basic',
        newPrice: 30,
        newCycle: BillingCycle.MONTHLY,
        cycleStartDate: start,
        cycleEndDate: end,
        effectiveDate: now,
      });

      expect(result.mode).toBe('downgrade');
      expect(result.isCredit).toBe(true);
      expect(result.netProratedAmount).toBe(15);
      expect(result.explanationText).toContain('account will be credited $15.00');
    });

    it('includes tax when config.includeTax is true', () => {
      const now = new Date('2026-01-16').getTime();
      const start = new Date('2026-01-01').getTime();
      const end = new Date('2026-01-31').getTime();

      const result = calculateProration({
        currentPlanId: 'p1',
        currentPlanName: 'Basic',
        currentPrice: 30,
        currentCycle: BillingCycle.MONTHLY,
        newPlanId: 'p2',
        newPlanName: 'Pro',
        newPrice: 60,
        newCycle: BillingCycle.MONTHLY,
        cycleStartDate: start,
        cycleEndDate: end,
        effectiveDate: now,
        config: {
          includeTax: true,
          defaultTaxRate: 10,
        },
      });

      expect(result.taxAmount).toBe(1.5); // 10% of $15
      expect(result.totalAmountDue).toBe(16.5);
      expect(result.breakdown).toHaveLength(3);
    });
  });

  describe('buildProrationAnalytics', () => {
    it('aggregates proration records correctly', () => {
      const sampleResult = calculateProration({
        currentPlanId: 'p1',
        currentPlanName: 'Basic',
        currentPrice: 30,
        currentCycle: BillingCycle.MONTHLY,
        newPlanId: 'p2',
        newPlanName: 'Pro',
        newPrice: 60,
        newCycle: BillingCycle.MONTHLY,
        cycleStartDate: new Date('2026-01-01').getTime(),
        cycleEndDate: new Date('2026-01-31').getTime(),
        effectiveDate: new Date('2026-01-16').getTime(),
      });

      const records: ProrationRecord[] = [
        {
          id: 'r1',
          subscriptionId: 'sub-1',
          result: sampleResult,
          status: 'applied',
          createdAt: Date.now(),
        },
      ];

      const analytics = buildProrationAnalytics(records);
      expect(analytics.totalCalculations).toBe(1);
      expect(analytics.totalUpgrades).toBe(1);
      expect(analytics.totalProratedRevenueCollected).toBe(15);
      expect(analytics.mostCommonUpgradePath).toEqual({
        fromPlan: 'Basic',
        toPlan: 'Pro',
        count: 1,
      });
    });
  });
});
