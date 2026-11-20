/**
 * mobile/src/screens/upgrade/__tests__/selectors.test.ts
 *
 * Unit tests for Upgrade selectors and mathematical calculations.
 */

import {
  calculateAnnualSavings,
  calculateProrationQuote,
  DEFAULT_FEATURES,
  DEFAULT_PLANS,
  diffPlanFeatures,
  formatMoney,
  isUpgradeAllowed,
} from '../selectors';

describe('Upgrade Screen Selectors', () => {
  describe('isUpgradeAllowed', () => {
    it('allows upgrades to higher tiers only', () => {
      expect(isUpgradeAllowed('starter', 'pro')).toBe(true);
      expect(isUpgradeAllowed('starter', 'enterprise')).toBe(true);
      expect(isUpgradeAllowed('pro', 'enterprise')).toBe(true);

      // Same or lower is not an upgrade
      expect(isUpgradeAllowed('pro', 'starter')).toBe(false);
      expect(isUpgradeAllowed('pro', 'pro')).toBe(false);
      expect(isUpgradeAllowed('enterprise', 'pro')).toBe(false);
    });
  });

  describe('calculateAnnualSavings', () => {
    it('computes percentage and dollar savings accurately', () => {
      // Pro plan: $15/mo vs $12/mo annual equivalent
      const savings = calculateAnnualSavings(15, 12);
      expect(savings.savingsPercent).toBe(20);
      expect(savings.annualBilledTotal).toBe(144);
      expect(savings.yearlySavings).toBe(36);
    });
  });

  describe('calculateProrationQuote', () => {
    it('calculates unused credit and due today amount for monthly plan', () => {
      // Starter: $5/mo. Pro: $15/mo.
      // 15 days remaining out of 30 => 50% of $5 = $2.50 credit
      // Due today = $15 - $2.50 = $12.50
      const quote = calculateProrationQuote('starter', 'pro', 'monthly', 15, 30);
      expect(quote.unusedCredit).toBe(2.5);
      expect(quote.grossTargetPrice).toBe(15);
      expect(quote.dueToday).toBe(12.5);
      expect(quote.billingCycle).toBe('monthly');
    });

    it('calculates proration with annual billing cycle', () => {
      // Starter annual: $4 * 12 = $48. Pro annual: $12 * 12 = $144.
      // 15 days remaining out of 30 => 50% unused => $24 credit
      // Due today = $144 - $24 = $120.00
      const quote = calculateProrationQuote('starter', 'pro', 'annual', 15, 30);
      expect(quote.unusedCredit).toBe(24);
      expect(quote.grossTargetPrice).toBe(144);
      expect(quote.dueToday).toBe(120);
      expect(quote.annualSavingsPercent).toBe(20);
    });

    it('floors due today at 0 when unused credit exceeds target price', () => {
      const mockPlans = {
        ...DEFAULT_PLANS,
        starter: { ...DEFAULT_PLANS.starter, monthlyPrice: 100 },
        pro: { ...DEFAULT_PLANS.pro, monthlyPrice: 10 },
      };
      const quote = calculateProrationQuote('starter', 'pro', 'monthly', 30, 30, mockPlans);
      expect(quote.dueToday).toBe(0);
    });
  });

  describe('diffPlanFeatures', () => {
    it('identifies newly unlocked perks for target plan', () => {
      const diff = diffPlanFeatures('starter', 'pro', DEFAULT_FEATURES);
      const unlockedIds = diff.unlocked.map((f) => f.id);

      expect(unlockedIds).toContain('unlimited_subs');
      expect(unlockedIds).toContain('renewal_ai');
      expect(unlockedIds).toContain('tax_receipts');
      expect(unlockedIds).toContain('stellar_multichain');
      expect(unlockedIds).not.toContain('dedicated_sla'); // Enterprise only
    });

    it('returns dedicated sla when upgrading from pro to enterprise', () => {
      const diff = diffPlanFeatures('pro', 'enterprise', DEFAULT_FEATURES);
      const unlockedIds = diff.unlocked.map((f) => f.id);
      expect(unlockedIds).toEqual(['dedicated_sla']);
    });
  });

  describe('formatMoney', () => {
    it('formats dollar amounts cleanly', () => {
      expect(formatMoney(15)).toContain('15');
      expect(formatMoney(0)).toContain('0');
    });
  });
});
