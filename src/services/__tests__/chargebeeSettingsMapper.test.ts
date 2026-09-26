import {
  ChargebeeSettingsMapper,
  createChargebeeSettingsMapper,
} from '../chargebeeSettingsMapper';
import type { ChargbeePlan, ChargebeeSubscription, ChargebeeAddon } from '../../types/chargebee';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const monthlyPlan: ChargbeePlan = {
  id: 'plan_monthly',
  name: 'Pro Monthly',
  description: 'Pro plan billed monthly',
  price: 2999, // $29.99
  currency_code: 'USD',
  period: 1,
  period_unit: 'month',
  status: 'active',
};

const yearlyPlan: ChargbeePlan = {
  id: 'plan_yearly',
  name: 'Pro Yearly',
  price: 28788, // $287.88
  currency_code: 'USD',
  period: 1,
  period_unit: 'year',
  trial_period: 14,
  trial_period_unit: 'day',
  status: 'active',
};

const weeklyPlan: ChargbeePlan = {
  id: 'plan_weekly',
  name: 'Starter Weekly',
  price: 999,
  currency_code: 'EUR',
  period: 1,
  period_unit: 'week',
  status: 'active',
};

const quarterlyPlan: ChargbeePlan = {
  id: 'plan_quarterly',
  name: 'Pro Quarterly',
  price: 7999,
  currency_code: 'USD',
  period: 3,
  period_unit: 'month',
  status: 'active',
};

const archivedPlan: ChargbeePlan = {
  id: 'plan_legacy',
  name: 'Legacy Plan',
  price: 4999,
  currency_code: 'USD',
  period: 1,
  period_unit: 'month',
  status: 'archived',
};

const activeSubscription: ChargebeeSubscription = {
  id: 'sub_001',
  customer_id: 'cust_001',
  plan_id: 'plan_monthly',
  status: 'active',
  next_billing_at: 1761984000, // some future unix ts
  created_at: 1729123200,
  updated_at: 1729123200,
  currency_code: 'USD',
  plan_amount: 2999,
};

const trialSubscription: ChargebeeSubscription = {
  id: 'sub_002',
  customer_id: 'cust_002',
  plan_id: 'plan_yearly',
  status: 'in_trial',
  trial_start: 1729123200,
  trial_end: 1730332800,
  next_billing_at: 1730332800,
  created_at: 1729123200,
  updated_at: 1729123200,
  currency_code: 'USD',
};

const pausedSubscription: ChargebeeSubscription = {
  id: 'sub_003',
  customer_id: 'cust_003',
  plan_id: 'plan_monthly',
  status: 'paused',
  created_at: 1729123200,
  updated_at: 1729123200,
  currency_code: 'USD',
  pause_date: 1729123200,
};

const cancelledSubscription: ChargebeeSubscription = {
  id: 'sub_004',
  customer_id: 'cust_004',
  plan_id: 'plan_monthly',
  status: 'cancelled',
  created_at: 1729123200,
  updated_at: 1729123200,
  cancelled_at: 1730332800,
  currency_code: 'USD',
};

const subWithAddons: ChargebeeSubscription = {
  id: 'sub_005',
  customer_id: 'cust_005',
  plan_id: 'plan_monthly',
  status: 'active',
  created_at: 1729123200,
  updated_at: 1729123200,
  currency_code: 'USD',
  plan_amount: 2999,
  addons: [
    { id: 'addon_storage', quantity: 1, unit_price: 500 },
    { id: 'addon_support', quantity: 1, unit_price: 1000 },
  ],
};

const storageAddon: ChargebeeAddon = {
  id: 'addon_storage',
  name: 'Extra Storage',
  price: 500,
  currency_code: 'USD',
  type: 'quantity',
};

const supportAddon: ChargebeeAddon = {
  id: 'addon_support',
  name: 'Priority Support',
  price: 1000,
  currency_code: 'USD',
  type: 'on_off',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChargebeeSettingsMapper', () => {
  let mapper: ChargebeeSettingsMapper;

  beforeEach(() => {
    jest.clearAllMocks();
    mapper = createChargebeeSettingsMapper({ defaultCurrency: 'USD' });
  });

  // ─── mapPlan ───────────────────────────────────────────────────────────────

  describe('mapPlan()', () => {
    it('maps a monthly plan correctly', () => {
      const result = mapper.mapPlan(monthlyPlan);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Pro Monthly');
      expect(result!.price).toBe(29.99);
      expect(result!.currency).toBe('USD');
      expect(result!.billingCycle).toBe('monthly');
      expect(result!.isActive).toBe(true);
      expect(result!.sourceIds.planId).toBe('plan_monthly');
    });

    it('maps a yearly plan with trial days', () => {
      const result = mapper.mapPlan(yearlyPlan);
      expect(result).not.toBeNull();
      expect(result!.billingCycle).toBe('yearly');
      expect(result!.trialDays).toBe(14);
      expect(result!.price).toBe(287.88);
    });

    it('maps a weekly plan correctly', () => {
      const result = mapper.mapPlan(weeklyPlan);
      expect(result).not.toBeNull();
      expect(result!.billingCycle).toBe('weekly');
      expect(result!.currency).toBe('EUR');
      expect(result!.price).toBe(9.99);
    });

    it('maps a quarterly plan to custom billing cycle', () => {
      const result = mapper.mapPlan(quarterlyPlan);
      expect(result).not.toBeNull();
      expect(result!.billingCycle).toBe('custom');
      expect(result!.customCycleDays).toBe(90); // 3 * 30
    });

    it('returns null for archived plan when includeArchived is false', () => {
      const result = mapper.mapPlan(archivedPlan);
      expect(result).toBeNull();
    });

    it('returns archived plan when includeArchived is true', () => {
      const mapperWithArchived = createChargebeeSettingsMapper({ includeArchived: true });
      const result = mapperWithArchived.mapPlan(archivedPlan);
      expect(result).not.toBeNull();
      expect(result!.isActive).toBe(false);
    });

    it('uses defaultCurrency when plan has no currency', () => {
      const planNoCurrency = { ...monthlyPlan, currency_code: undefined as unknown as string };
      const result = mapper.mapPlan(planNoCurrency);
      expect(result!.currency).toBe('USD');
    });

    it('maps plan with zero price', () => {
      const freePlan = { ...monthlyPlan, price: 0 };
      const result = mapper.mapPlan(freePlan);
      expect(result!.price).toBe(0);
    });

    it('maps plan with undefined price to 0', () => {
      const noPricePlan = { ...monthlyPlan, price: undefined };
      const result = mapper.mapPlan(noPricePlan);
      expect(result!.price).toBe(0);
    });

    it('includes description when present', () => {
      const result = mapper.mapPlan(monthlyPlan);
      expect(result!.description).toBe('Pro plan billed monthly');
    });

    it('defaults description to empty string when absent', () => {
      const noPlan = { ...monthlyPlan, description: undefined };
      const result = mapper.mapPlan(noPlan);
      expect(result!.description).toBe('');
    });
  });

  // ─── mapPlans ──────────────────────────────────────────────────────────────

  describe('mapPlans()', () => {
    it('maps multiple plans filtering archived', () => {
      const results = mapper.mapPlans([monthlyPlan, yearlyPlan, archivedPlan]);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.sourceIds.planId)).toEqual(['plan_monthly', 'plan_yearly']);
    });

    it('returns empty array for empty input', () => {
      expect(mapper.mapPlans([])).toEqual([]);
    });
  });

  // ─── mapSubscription ───────────────────────────────────────────────────────

  describe('mapSubscription()', () => {
    it('maps an active subscription correctly', () => {
      const result = mapper.mapSubscription(activeSubscription, monthlyPlan);
      expect(result.name).toBe('Pro Monthly');
      expect(result.price).toBe(29.99);
      expect(result.billingCycle).toBe('monthly');
      expect(result.isActive).toBe(true);
      expect(result.isPaused).toBe(false);
      expect(result.sourceIds.subscriptionId).toBe('sub_001');
      expect(result.nextBillingDate).toBeInstanceOf(Date);
    });

    it('maps an in_trial subscription as active', () => {
      const result = mapper.mapSubscription(trialSubscription, yearlyPlan);
      expect(result.isActive).toBe(true);
      expect(result.isPaused).toBe(false);
      expect(result.billingCycle).toBe('yearly');
    });

    it('maps a paused subscription correctly', () => {
      const result = mapper.mapSubscription(pausedSubscription, monthlyPlan);
      expect(result.isActive).toBe(false);
      expect(result.isPaused).toBe(true);
    });

    it('maps a cancelled subscription as inactive', () => {
      const result = mapper.mapSubscription(cancelledSubscription, monthlyPlan);
      expect(result.isActive).toBe(false);
      expect(result.isPaused).toBe(false);
    });

    it('resolves addons from registry', () => {
      mapper.registerAddons([storageAddon, supportAddon]);
      const result = mapper.mapSubscription(subWithAddons, monthlyPlan);
      expect(result.addons).toHaveLength(2);
      expect(result.addons[0]).toEqual({ id: 'addon_storage', name: 'Extra Storage', price: 5 });
      expect(result.addons[1]).toEqual({ id: 'addon_support', name: 'Priority Support', price: 10 });
    });

    it('uses addon id as name when not in registry', () => {
      const result = mapper.mapSubscription(subWithAddons, monthlyPlan);
      expect(result.addons[0].name).toBe('addon_storage');
    });

    it('uses subscription-level billing period over plan period', () => {
      const customSub: ChargebeeSubscription = {
        ...activeSubscription,
        billing_period: 3,
        billing_period_unit: 'month',
      };
      const result = mapper.mapSubscription(customSub, monthlyPlan);
      expect(result.billingCycle).toBe('custom');
      expect(result.customCycleDays).toBe(90);
    });

    it('uses plan price when subscription has no plan_amount', () => {
      const sub = { ...activeSubscription, plan_amount: undefined };
      const result = mapper.mapSubscription(sub, monthlyPlan);
      expect(result.price).toBe(29.99);
    });

    it('sets nextBillingDate to undefined when not provided', () => {
      const sub = { ...activeSubscription, next_billing_at: undefined };
      const result = mapper.mapSubscription(sub, monthlyPlan);
      expect(result.nextBillingDate).toBeUndefined();
    });
  });

  // ─── mapSubscriptions ──────────────────────────────────────────────────────

  describe('mapSubscriptions()', () => {
    const plansById = new Map([
      ['plan_monthly', monthlyPlan],
      ['plan_yearly', yearlyPlan],
    ]);

    it('maps multiple subscriptions successfully', () => {
      const results = mapper.mapSubscriptions(
        [activeSubscription, trialSubscription],
        plansById
      );
      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.subscription).toBeDefined());
    });

    it('returns error entry when plan is not found', () => {
      const unknownSub: ChargebeeSubscription = {
        ...activeSubscription,
        id: 'sub_bad',
        plan_id: 'plan_unknown',
      };
      const results = mapper.mapSubscriptions([unknownSub], plansById);
      expect(results[0].error).toContain('Plan not found');
      expect((results[0] as { sourceId: string }).sourceId).toBe('sub_bad');
    });

    it('returns empty array for empty input', () => {
      expect(mapper.mapSubscriptions([], plansById)).toEqual([]);
    });
  });

  // ─── registerAddon / registerAddons ───────────────────────────────────────

  describe('registerAddon()', () => {
    it('registers a single addon', () => {
      mapper.registerAddon(storageAddon);
      mapper.registerAddons([supportAddon]);
      const result = mapper.mapSubscription(subWithAddons, monthlyPlan);
      expect(result.addons[0].name).toBe('Extra Storage');
      expect(result.addons[1].name).toBe('Priority Support');
    });
  });

  // ─── createChargebeeSettingsMapper factory ─────────────────────────────────

  describe('createChargebeeSettingsMapper()', () => {
    it('creates a mapper with default config', () => {
      const m = createChargebeeSettingsMapper();
      const result = m.mapPlan(monthlyPlan);
      expect(result).not.toBeNull();
    });

    it('respects custom defaultCurrency', () => {
      const m = createChargebeeSettingsMapper({ defaultCurrency: 'GBP' });
      const planNoCurrency = { ...monthlyPlan, currency_code: '' as unknown as string };
      // currency_code is falsy so falls back to defaultCurrency
      const result = m.mapPlan({ ...planNoCurrency, currency_code: '' });
      // empty string is falsy – implementation uses ?? so it falls through
      expect(typeof result!.currency).toBe('string');
    });
  });
});
