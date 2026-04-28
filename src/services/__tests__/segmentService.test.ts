import { segmentService } from '../segmentService';
import { Segment, CriteriaOperator, SubscriberData, SegmentRule } from '../../types/segment';
import { SubscriptionCategory, BillingCycle } from '../../types/subscription';

describe('SegmentService', () => {
  const mockSubscriber: SubscriberData = {
    id: 'user-1',
    name: 'John Doe',
    email: 'john@example.com',
    totalMonthlySpend: 150,
    totalYearlySpend: 1800,
    activeSubscriptionCount: 3,
    categories: [SubscriptionCategory.STREAMING, SubscriptionCategory.SOFTWARE],
    billingCycles: [BillingCycle.MONTHLY],
    currencies: ['USD'],
    daysSinceLastActive: 2,
  };

  describe('evaluateRule', () => {
    it('should evaluate GREATER_THAN correctly', () => {
      const rule: SegmentRule = {
        id: 'r1',
        field: 'totalMonthlySpend',
        operator: CriteriaOperator.GREATER_THAN,
        value: 100,
      };
      expect(segmentService.evaluateRule(mockSubscriber, rule)).toBe(true);
    });

    it('should evaluate EQUALS correctly', () => {
      const rule: SegmentRule = {
        id: 'r2',
        field: 'activeSubscriptionCount',
        operator: CriteriaOperator.EQUALS,
        value: 3,
      };
      expect(segmentService.evaluateRule(mockSubscriber, rule)).toBe(true);
    });

    it('should evaluate CONTAINS correctly for arrays', () => {
      const rule: SegmentRule = {
        id: 'r3',
        field: 'categories',
        operator: CriteriaOperator.CONTAINS,
        value: SubscriptionCategory.STREAMING,
      };
      expect(segmentService.evaluateRule(mockSubscriber, rule)).toBe(true);
    });

    it('should evaluate CONTAINS correctly for strings', () => {
      const rule: SegmentRule = {
        id: 'r4',
        field: 'name',
        operator: CriteriaOperator.CONTAINS,
        value: 'John',
      };
      expect(segmentService.evaluateRule(mockSubscriber, rule)).toBe(true);
    });
  });

  describe('isSubscriberInSegment', () => {
    const segment: Segment = {
      id: 'seg-1',
      name: 'High Value',
      description: 'Spend > 100',
      criteria: [
        {
          id: 'r1',
          field: 'totalMonthlySpend',
          operator: CriteriaOperator.GREATER_THAN,
          value: 100,
        },
        {
          id: 'r2',
          field: 'activeSubscriptionCount',
          operator: CriteriaOperator.GREATER_THAN,
          value: 5,
        },
      ],
      logic: 'AND',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should return false for AND logic if one rule fails', () => {
      expect(segmentService.isSubscriberInSegment(mockSubscriber, segment)).toBe(false);
    });

    it('should return true for OR logic if one rule passes', () => {
      const orSegment = { ...segment, logic: 'OR' as const };
      expect(segmentService.isSubscriberInSegment(mockSubscriber, orSegment)).toBe(true);
    });
  });

  describe('applyPricingRule', () => {
    it('should apply discountPercentage correctly', () => {
      const rule = { discountPercentage: 20 };
      expect(segmentService.applyPricingRule(100, rule)).toBe(80);
    });

    it('should apply fixedDiscount correctly', () => {
      const rule = { fixedDiscount: 15 };
      expect(segmentService.applyPricingRule(100, rule)).toBe(85);
    });

    it('should apply overridePrice correctly', () => {
      const rule = { overridePrice: 50 };
      expect(segmentService.applyPricingRule(100, rule)).toBe(50);
    });
  });
});
