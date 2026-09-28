import {
  SubscriptionQAFactory,
  SubscriptionQAScenarios,
  SubscriptionQASimulator,
  SubscriptionQAAssertions,
} from '../subscriptionQAHelpers';

describe('SubscriptionQAHelpers Unit Tests', () => {
  beforeEach(() => {
    SubscriptionQAFactory.resetCounter();
  });

  describe('SubscriptionQAFactory', () => {
    it('creates mock plan with sensible defaults', () => {
      const plan = SubscriptionQAFactory.createMockPlan();
      expect(plan.id).toMatch(/^plan_qa_\d+$/);
      expect(plan.name).toContain('QA Plan');
      expect(plan.price).toBe(19.99);
      expect(plan.currency).toBe('USD');
      expect(plan.interval).toBe('monthly');
      expect(plan.active).toBe(true);
    });

    it('creates mock plan with overrides', () => {
      const plan = SubscriptionQAFactory.createMockPlan({
        price: 49.99,
        interval: 'yearly',
        currency: 'EUR',
      });
      expect(plan.price).toBe(49.99);
      expect(plan.interval).toBe('yearly');
      expect(plan.currency).toBe('EUR');
    });

    it('creates mock user with deterministic ID and email', () => {
      const user = SubscriptionQAFactory.createMockUser();
      expect(user.id).toMatch(/^user_qa_\d+$/);
      expect(user.email).toBe(`${user.id}@qa.example.com`);
    });

    it('creates mock subscription with defaults', () => {
      const sub = SubscriptionQAFactory.createMockSubscription();
      expect(sub.id).toMatch(/^sub_qa_\d+$/);
      expect(sub.status).toBe('active');
      expect(sub.amount).toBe(19.99);
      expect(sub.currency).toBe('USD');
    });

    it('creates full subscription scenario with linked entities', () => {
      const scenario = SubscriptionQAFactory.createFullScenario({
        plan: { price: 29.99 },
        user: { email: 'custom@example.com' },
      });

      expect(scenario.merchant.id).toBeDefined();
      expect(scenario.plan.merchantId).toBe(scenario.merchant.id);
      expect(scenario.plan.price).toBe(29.99);
      expect(scenario.user.email).toBe('custom@example.com');
      expect(scenario.subscription.userId).toBe(scenario.user.id);
      expect(scenario.subscription.planId).toBe(scenario.plan.id);
      expect(scenario.subscription.amount).toBe(29.99);
      expect(scenario.invoice.subscriptionId).toBe(scenario.subscription.id);
    });
  });

  describe('SubscriptionQAScenarios', () => {
    it('generates a batch of subscriptions', () => {
      const batch = SubscriptionQAScenarios.createSubscriptionBatch(5, { currency: 'GBP' });
      expect(batch).toHaveLength(5);
      batch.forEach((sub) => {
        expect(sub.currency).toBe('GBP');
        expect(sub.status).toBe('active');
      });
    });

    it('generates expiring subscriptions', () => {
      const expiring = SubscriptionQAScenarios.createExpiringSubscriptions(3, 2);
      expect(expiring).toHaveLength(3);
      expiring.forEach((sub) => {
        expect(sub.status).toBe('active');
        const nextBilling = new Date(sub.nextBillingAt).getTime();
        expect(nextBilling).toBeGreaterThan(Date.now());
      });
    });

    it('generates past_due subscriptions', () => {
      const pastDue = SubscriptionQAScenarios.createPastDueSubscriptions(4);
      expect(pastDue).toHaveLength(4);
      pastDue.forEach((sub) => {
        expect(sub.status).toBe('past_due');
      });
    });

    it('generates trialing subscriptions', () => {
      const trials = SubscriptionQAScenarios.createTrialSubscriptions(2, 14);
      expect(trials).toHaveLength(2);
      trials.forEach((sub) => {
        expect(sub.status).toBe('trialing');
        expect(sub.trialEndsAt).toBeDefined();
      });
    });
  });

  describe('SubscriptionQASimulator', () => {
    it('simulates billing cycle and advances nextBillingAt', () => {
      const initialSub = SubscriptionQAFactory.createMockSubscription();
      const result = SubscriptionQASimulator.simulateBillingCycle(initialSub);

      expect(result.subscription.status).toBe('active');
      expect(new Date(result.subscription.nextBillingAt).getTime()).toBeGreaterThan(
        new Date(initialSub.nextBillingAt).getTime(),
      );
      expect(result.invoice.status).toBe('paid');
      expect(result.invoice.amount).toBe(initialSub.amount);
    });

    it('simulates cancellation with reason', () => {
      const initialSub = SubscriptionQAFactory.createMockSubscription();
      const result = SubscriptionQASimulator.simulateCancellation(initialSub, 'Too expensive');

      expect(result.subscription.status).toBe('cancelled');
      expect(result.subscription.cancellationReason).toBe('Too expensive');
      expect(result.cancelledAt).toBeDefined();
    });

    it('simulates trial expiry transition to active', () => {
      const trialSub = SubscriptionQAFactory.createMockSubscription({
        status: 'trialing',
        trialEndsAt: new Date().toISOString(),
      });
      const activeSub = SubscriptionQASimulator.simulateTrialExpiry(trialSub);

      expect(activeSub.status).toBe('active');
      expect(activeSub.trialEndsAt).toBeUndefined();
    });
  });

  describe('SubscriptionQAAssertions', () => {
    it('validates a correct subscription', () => {
      const sub = SubscriptionQAFactory.createMockSubscription();
      const validation = SubscriptionQAAssertions.validateSubscription(sub);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('detects invalid status, negative amount, and missing fields', () => {
      const invalidSub: any = {
        id: 'sub_invalid',
        userId: '',
        planId: 'plan_1',
        status: 'unknown_status',
        amount: -10,
        currency: 'INVALID',
        nextBillingAt: 'not-a-date',
      };
      const validation = SubscriptionQAAssertions.validateSubscription(invalidSub);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toEqual(
        expect.arrayContaining([
          'Missing userId',
          'Invalid status: unknown_status',
          'Amount must be a non-negative number',
          'Currency must be a 3-letter ISO code',
          'Invalid nextBillingAt timestamp',
        ]),
      );
    });

    it('validates allowed state transitions', () => {
      expect(SubscriptionQAAssertions.isAllowedTransition('active', 'paused')).toBe(true);
      expect(SubscriptionQAAssertions.isAllowedTransition('active', 'cancelled')).toBe(true);
      expect(SubscriptionQAAssertions.isAllowedTransition('paused', 'active')).toBe(true);
      expect(SubscriptionQAAssertions.isAllowedTransition('trialing', 'active')).toBe(true);
      expect(SubscriptionQAAssertions.isAllowedTransition('cancelled', 'active')).toBe(false);
    });
  });
});
