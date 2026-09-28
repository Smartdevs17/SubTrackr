import {
  calculateAnnualDiscount,
  convertMonthlyToAnnualRate,
  createAnnualBillingPlan,
  isAnnualBillingCycle,
} from '../annualBilling';
import { BillingCycle } from '../../types/subscription';

describe('annualBilling utility', () => {
  describe('calculateAnnualDiscount', () => {
    it('calculates savings amount and percentage correctly', () => {
      // $10/mo = $120/yr vs $100/yr annual plan -> $20 (17%) savings
      const discount = calculateAnnualDiscount(10, 100);
      expect(discount.savingsAmount).toBe(20);
      expect(discount.savingsPercentage).toBe(17);
    });

    it('returns 0 savings if annual price equals 12 months of monthly price', () => {
      const discount = calculateAnnualDiscount(10, 120);
      expect(discount.savingsAmount).toBe(0);
      expect(discount.savingsPercentage).toBe(0);
    });

    it('handles negative or zero price inputs gracefully', () => {
      const discount = calculateAnnualDiscount(0, 0);
      expect(discount.savingsAmount).toBe(0);
      expect(discount.savingsPercentage).toBe(0);
    });
  });

  describe('convertMonthlyToAnnualRate', () => {
    it('calculates discounted annual rate with default 15% discount', () => {
      // $20/mo * 12 = $240 * 0.85 = $204
      const annualRate = convertMonthlyToAnnualRate(20);
      expect(annualRate).toBe(204);
    });

    it('calculates annual rate with custom discount percentage', () => {
      // $10/mo * 12 = $120 * 0.80 = $96
      const annualRate = convertMonthlyToAnnualRate(10, 20);
      expect(annualRate).toBe(96);
    });

    it('returns 0 for zero or negative monthly rates', () => {
      expect(convertMonthlyToAnnualRate(0)).toBe(0);
      expect(convertMonthlyToAnnualRate(-5)).toBe(0);
    });
  });

  describe('isAnnualBillingCycle', () => {
    it('identifies BillingCycle.ANNUAL and BillingCycle.YEARLY as annual cycles', () => {
      expect(isAnnualBillingCycle(BillingCycle.ANNUAL)).toBe(true);
      expect(isAnnualBillingCycle(BillingCycle.YEARLY)).toBe(true);
      expect(isAnnualBillingCycle('annual')).toBe(true);
      expect(isAnnualBillingCycle('yearly')).toBe(true);
    });

    it('returns false for non-annual billing cycles', () => {
      expect(isAnnualBillingCycle(BillingCycle.MONTHLY)).toBe(false);
      expect(isAnnualBillingCycle(BillingCycle.WEEKLY)).toBe(false);
      expect(isAnnualBillingCycle(BillingCycle.CUSTOM)).toBe(false);
    });
  });

  describe('createAnnualBillingPlan', () => {
    it('constructs an AnnualBillingPlan object with correct properties', () => {
      const plan = createAnnualBillingPlan('plan_pro', 'Pro Plan', 15, 20);
      expect(plan.id).toBe('plan_pro');
      expect(plan.name).toBe('Pro Plan');
      expect(plan.monthlyRate).toBe(15);
      expect(plan.discountPercentage).toBe(20);
      expect(plan.annualRate).toBe(144); // 15 * 12 * 0.80 = 144
      expect(plan.isAnnualOptionAvailable).toBe(true);
    });
  });
});
