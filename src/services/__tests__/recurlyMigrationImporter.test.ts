import {
  RecurlyMigrationImporter,
  createRecurlyMigrationImporter,
} from '../recurlyMigrationImporter';
import type { RecurlySubscription, RecurlyPlan } from '../../types/recurly';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const monthlyPlan: RecurlyPlan = {
  code: 'pro-monthly',
  name: 'Pro Monthly',
  description: 'Professional plan billed monthly',
  unit_amount_in_cents: 2999,
  currency: 'USD',
  plan_interval_length: 1,
  plan_interval_unit: 'months',
  state: 'active',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const yearlyPlan: RecurlyPlan = {
  code: 'pro-yearly',
  name: 'Pro Yearly',
  description: 'Professional plan billed yearly',
  unit_amount_in_cents: 28788,
  currency: 'USD',
  plan_interval_length: 12,
  plan_interval_unit: 'months',
  trial_interval_length: 14,
  trial_interval_unit: 'days',
  state: 'active',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const weeklyPlan: RecurlyPlan = {
  code: 'starter-weekly',
  name: 'Starter Weekly',
  unit_amount_in_cents: 999,
  currency: 'EUR',
  plan_interval_length: 7,
  plan_interval_unit: 'days',
  state: 'active',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

function makeSub(overrides: Partial<RecurlySubscription> = {}): RecurlySubscription {
  return {
    uuid: 'sub-001',
    account: { account_code: 'acc-001', email: 'user@example.com' },
    plan: {
      code: 'pro-monthly',
      name: 'Pro Monthly',
      plan_interval_length: 1,
      plan_interval_unit: 'months',
    },
    state: 'active',
    unit_amount_in_cents: 2999,
    currency: 'USD',
    quantity: 1,
    current_period_started_at: '2026-09-01T00:00:00Z',
    current_period_ends_at: '2026-10-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RecurlyMigrationImporter', () => {
  let importer: RecurlyMigrationImporter;

  beforeEach(() => {
    jest.clearAllMocks();
    importer = createRecurlyMigrationImporter({ defaultCurrency: 'USD' });
    importer.registerPlans([monthlyPlan, yearlyPlan, weeklyPlan]);
  });

  // ─── importSubscription ───────────────────────────────────────────────────

  describe('importSubscription()', () => {
    it('maps an active monthly subscription', () => {
      const result = importer.importSubscription(makeSub());
      expect(result.recurlyUuid).toBe('sub-001');
      expect(result.accountCode).toBe('acc-001');
      expect(result.name).toBe('Pro Monthly');
      expect(result.price).toBe(29.99);
      expect(result.currency).toBe('USD');
      expect(result.billingCycle).toBe('monthly');
      expect(result.isActive).toBe(true);
      expect(result.isPaused).toBe(false);
      expect(result.isCryptoEnabled).toBe(false);
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('sets nextBillingDate from current_period_ends_at', () => {
      const result = importer.importSubscription(makeSub());
      expect(result.nextBillingDate).toBeInstanceOf(Date);
      expect(result.nextBillingDate!.toISOString()).toContain('2026-10-01');
    });

    it('maps yearly subscription with billing cycle yearly', () => {
      const sub = makeSub({
        uuid: 'sub-002',
        plan: {
          code: 'pro-yearly',
          name: 'Pro Yearly',
          plan_interval_length: 12,
          plan_interval_unit: 'months',
        },
        unit_amount_in_cents: 28788,
      });
      const result = importer.importSubscription(sub);
      expect(result.billingCycle).toBe('yearly');
      expect(result.trialDays).toBe(14);
    });

    it('maps weekly subscription', () => {
      const sub = makeSub({
        plan: {
          code: 'starter-weekly',
          name: 'Starter Weekly',
          plan_interval_length: 7,
          plan_interval_unit: 'days',
        },
        currency: 'EUR',
        unit_amount_in_cents: 999,
      });
      const result = importer.importSubscription(sub);
      expect(result.billingCycle).toBe('weekly');
      expect(result.currency).toBe('EUR');
    });

    it('maps custom cycle (3 months)', () => {
      const sub = makeSub({
        plan: {
          code: 'pro-quarterly',
          name: 'Pro Quarterly',
          plan_interval_length: 3,
          plan_interval_unit: 'months',
        },
      });
      const result = importer.importSubscription(sub);
      expect(result.billingCycle).toBe('custom');
      expect(result.customCycleDays).toBe(90);
    });

    it('maps paused subscription', () => {
      const result = importer.importSubscription(makeSub({ state: 'paused' }));
      expect(result.isActive).toBe(false);
      expect(result.isPaused).toBe(true);
    });

    it('maps cancelled subscription as inactive', () => {
      const result = importer.importSubscription(makeSub({ state: 'canceled' }));
      expect(result.isActive).toBe(false);
      expect(result.isPaused).toBe(false);
    });

    it('maps future subscription as active', () => {
      const result = importer.importSubscription(makeSub({ state: 'future' }));
      expect(result.isActive).toBe(true);
    });

    it('multiplies price by quantity', () => {
      const result = importer.importSubscription(
        makeSub({ unit_amount_in_cents: 1000, quantity: 3 })
      );
      expect(result.price).toBe(30.0);
    });

    it('maps add-ons correctly', () => {
      const sub = makeSub({
        add_ons: [
          { add_on_code: 'storage', name: 'Extra Storage', unit_amount_in_cents: 500, quantity: 2 },
        ],
      });
      const result = importer.importSubscription(sub);
      expect(result.addons).toHaveLength(1);
      expect(result.addons[0]).toEqual({
        code: 'storage',
        name: 'Extra Storage',
        price: 10.0,
        quantity: 2,
      });
    });

    it('falls back to defaultCurrency when subscription has no currency', () => {
      const sub = makeSub({ currency: '' });
      importer = createRecurlyMigrationImporter({ defaultCurrency: 'GBP' });
      importer.registerPlans([monthlyPlan]);
      const result = importer.importSubscription(sub);
      expect(result.currency).toBe('GBP');
    });

    it('uses empty description when plan not in registry', () => {
      const sub = makeSub({ plan: { code: 'unknown', name: 'Unknown', plan_interval_length: 1, plan_interval_unit: 'months' } });
      const result = importer.importSubscription(sub);
      expect(result.description).toBe('');
    });
  });

  // ─── importAll ────────────────────────────────────────────────────────────

  describe('importAll()', () => {
    it('imports multiple subscriptions and reports counts', () => {
      const subs = [
        makeSub({ uuid: 'sub-a' }),
        makeSub({ uuid: 'sub-b', state: 'canceled' }),
        makeSub({ uuid: 'sub-c', state: 'expired' }), // should be skipped by default
      ];
      const report = importer.importAll(subs);
      expect(report.total).toBe(3);
      expect(report.succeeded).toBe(2);
      expect(report.skipped).toBe(1);
      expect(report.failed).toBe(0);
      expect(report.skippedIds).toContain('sub-c');
    });

    it('returns empty report for empty input', () => {
      const report = importer.importAll([]);
      expect(report.total).toBe(0);
      expect(report.succeeded).toBe(0);
    });

    it('records error for invalid subscription', () => {
      // Force an error by passing invalid data
      const badSub = {
        uuid: 'bad-sub',
        account: { account_code: 'acc' },
        plan: {
          code: 'pro-monthly',
          name: 'Pro',
          plan_interval_length: NaN,
          plan_interval_unit: 'months' as const,
        },
        state: 'active' as const,
        unit_amount_in_cents: NaN,
        currency: 'USD',
        quantity: 1,
        created_at: 'invalid-date',
        updated_at: 'invalid-date',
      } as RecurlySubscription;

      // The importer should not throw but record the failure
      const localImporter = createRecurlyMigrationImporter();
      localImporter.registerPlans([monthlyPlan]);
      // NaN * 1 / 100 = NaN – toFixed on NaN produces "NaN" not an error,
      // so this won't actually error. Let's cause a real error instead.
      jest.spyOn(localImporter, 'importSubscription').mockImplementationOnce(() => {
        throw new Error('Simulated mapping error');
      });
      const report = localImporter.importAll([badSub]);
      expect(report.failed).toBe(1);
      expect(report.errors[0].recurlyUuid).toBe('bad-sub');
      expect(report.errors[0].reason).toContain('Simulated mapping error');
    });

    it('skips custom states when configured', () => {
      const customImporter = createRecurlyMigrationImporter({
        skipStates: ['canceled', 'expired', 'paused'],
      });
      customImporter.registerPlans([monthlyPlan]);
      const subs = [
        makeSub({ uuid: 'sub-1', state: 'active' }),
        makeSub({ uuid: 'sub-2', state: 'paused' }),
        makeSub({ uuid: 'sub-3', state: 'canceled' }),
      ];
      const report = customImporter.importAll(subs);
      expect(report.succeeded).toBe(1);
      expect(report.skipped).toBe(2);
    });
  });

  // ─── importBatch (async) ──────────────────────────────────────────────────

  describe('importBatch()', () => {
    it('returns a full MigrationReport with timestamps', async () => {
      const subs = [makeSub({ uuid: 'a' }), makeSub({ uuid: 'b' })];
      const report = await importer.importBatch(subs);
      expect(report.total).toBe(2);
      expect(report.succeeded).toBe(2);
      expect(report.startedAt).toBeInstanceOf(Date);
      expect(report.completedAt).toBeInstanceOf(Date);
      expect(report.completedAt.getTime()).toBeGreaterThanOrEqual(report.startedAt.getTime());
    });

    it('handles batches larger than batchSize', async () => {
      const smallBatchImporter = createRecurlyMigrationImporter({ batchSize: 2 });
      smallBatchImporter.registerPlans([monthlyPlan]);
      const subs = Array.from({ length: 5 }, (_, i) => makeSub({ uuid: `sub-${i}` }));
      const report = await smallBatchImporter.importBatch(subs);
      expect(report.succeeded).toBe(5);
    });
  });

  // ─── Plan registry ────────────────────────────────────────────────────────

  describe('registerPlan() / registerPlans() / getRegisteredPlan()', () => {
    it('registers and retrieves a single plan', () => {
      const freshImporter = createRecurlyMigrationImporter();
      freshImporter.registerPlan(monthlyPlan);
      expect(freshImporter.getRegisteredPlan('pro-monthly')).toEqual(monthlyPlan);
    });

    it('returns undefined for unregistered plan code', () => {
      const freshImporter = createRecurlyMigrationImporter();
      expect(freshImporter.getRegisteredPlan('nonexistent')).toBeUndefined();
    });
  });
});
