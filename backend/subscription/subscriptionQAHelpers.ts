/**
 * subscriptionQAHelpers.ts — Subscription Test Helpers & QA Utilities.
 *
 * Provides factory functions, batch generators, simulation utilities, and assertion
 * helpers for testing subscription workflows across QA unit, integration, and E2E tests.
 */

export interface QAPlanFixture {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval: 'weekly' | 'monthly' | 'yearly';
  merchantId: string;
  active: boolean;
  trialDays?: number;
  createdAt: string;
}

export interface QAUserFixture {
  id: string;
  email: string;
  address?: string;
  name?: string;
  createdAt: string;
}

export interface QAMerchantFixture {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

export interface QASubscriptionFixture {
  id: string;
  userId: string;
  planId: string;
  merchantId?: string;
  status: 'active' | 'cancelled' | 'paused' | 'past_due' | 'trialing';
  startedAt: string;
  nextBillingAt: string;
  amount: number;
  currency: string;
  cancellationReason?: string;
  trialEndsAt?: string;
  metadata?: Record<string, unknown>;
}

export interface QAInvoiceFixture {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'voided';
  dueAt: string;
  paidAt: string | null;
}

let _qaCounter = 0;

function nextId(prefix: string): string {
  _qaCounter += 1;
  return `${prefix}_qa_${String(_qaCounter).padStart(5, '0')}`;
}

/**
 * Factory for creating deterministic, typed fixtures with sensible defaults.
 */
export class SubscriptionQAFactory {
  static resetCounter(): void {
    _qaCounter = 0;
  }

  static createMockPlan(overrides: Partial<QAPlanFixture> = {}): QAPlanFixture {
    const id = overrides.id ?? nextId('plan');
    return {
      id,
      name: `QA Plan ${id}`,
      price: 19.99,
      currency: 'USD',
      interval: 'monthly',
      merchantId: 'merchant_qa_default',
      active: true,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  static createMockUser(overrides: Partial<QAUserFixture> = {}): QAUserFixture {
    const id = overrides.id ?? nextId('user');
    return {
      id,
      email: `${id}@qa.example.com`,
      name: `QA User ${id}`,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  static createMockMerchant(overrides: Partial<QAMerchantFixture> = {}): QAMerchantFixture {
    const id = overrides.id ?? nextId('merchant');
    return {
      id,
      name: `QA Merchant ${id}`,
      email: `${id}@merchant.example.com`,
      active: true,
      ...overrides,
    };
  }

  static createMockSubscription(overrides: Partial<QASubscriptionFixture> = {}): QASubscriptionFixture {
    const id = overrides.id ?? nextId('sub');
    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 86_400_000);

    return {
      id,
      userId: overrides.userId ?? nextId('user'),
      planId: overrides.planId ?? nextId('plan'),
      status: 'active',
      startedAt: now.toISOString(),
      nextBillingAt: thirtyDays.toISOString(),
      amount: 19.99,
      currency: 'USD',
      ...overrides,
    };
  }

  static createMockInvoice(overrides: Partial<QAInvoiceFixture> = {}): QAInvoiceFixture {
    const id = overrides.id ?? nextId('inv');
    const now = new Date();
    return {
      id,
      subscriptionId: overrides.subscriptionId ?? nextId('sub'),
      amount: 19.99,
      currency: 'USD',
      status: 'pending',
      dueAt: now.toISOString(),
      paidAt: null,
      ...overrides,
    };
  }

  /**
   * Generates a complete relational subscription scenario: merchant -> plan -> user -> subscription -> invoice
   */
  static createFullScenario(overrides: {
    plan?: Partial<QAPlanFixture>;
    user?: Partial<QAUserFixture>;
    merchant?: Partial<QAMerchantFixture>;
    subscription?: Partial<QASubscriptionFixture>;
    invoice?: Partial<QAInvoiceFixture>;
  } = {}) {
    const merchant = SubscriptionQAFactory.createMockMerchant(overrides.merchant);
    const plan = SubscriptionQAFactory.createMockPlan({ merchantId: merchant.id, ...overrides.plan });
    const user = SubscriptionQAFactory.createMockUser(overrides.user);
    const subscription = SubscriptionQAFactory.createMockSubscription({
      userId: user.id,
      planId: plan.id,
      merchantId: merchant.id,
      amount: plan.price,
      currency: plan.currency,
      ...overrides.subscription,
    });
    const invoice = SubscriptionQAFactory.createMockInvoice({
      subscriptionId: subscription.id,
      amount: subscription.amount,
      currency: subscription.currency,
      ...overrides.invoice,
    });

    return { merchant, plan, user, subscription, invoice };
  }
}

/**
 * Scenario builders for generating batch data and specialized state sets.
 */
export class SubscriptionQAScenarios {
  static createSubscriptionBatch(
    count: number,
    commonOverrides: Partial<QASubscriptionFixture> = {},
  ): QASubscriptionFixture[] {
    const list: QASubscriptionFixture[] = [];
    for (let i = 0; i < count; i++) {
      list.push(SubscriptionQAFactory.createMockSubscription(commonOverrides));
    }
    return list;
  }

  static createExpiringSubscriptions(
    count: number,
    daysUntilExpiry = 3,
  ): QASubscriptionFixture[] {
    const expiryDate = new Date(Date.now() + daysUntilExpiry * 86_400_000).toISOString();
    return SubscriptionQAScenarios.createSubscriptionBatch(count, {
      status: 'active',
      nextBillingAt: expiryDate,
    });
  }

  static createPastDueSubscriptions(count: number): QASubscriptionFixture[] {
    const pastBillingAt = new Date(Date.now() - 5 * 86_400_000).toISOString();
    return SubscriptionQAScenarios.createSubscriptionBatch(count, {
      status: 'past_due',
      nextBillingAt: pastBillingAt,
    });
  }

  static createTrialSubscriptions(
    count: number,
    trialDaysRemaining = 7,
  ): QASubscriptionFixture[] {
    const trialEndsAt = new Date(Date.now() + trialDaysRemaining * 86_400_000).toISOString();
    return SubscriptionQAScenarios.createSubscriptionBatch(count, {
      status: 'trialing',
      trialEndsAt,
      nextBillingAt: trialEndsAt,
    });
  }
}

/**
 * Simulator for state transitions and workflow steps.
 */
export class SubscriptionQASimulator {
  static simulateBillingCycle(subscription: QASubscriptionFixture): {
    subscription: QASubscriptionFixture;
    invoice: QAInvoiceFixture;
  } {
    const currentBilling = new Date(subscription.nextBillingAt);
    const nextBilling = new Date(currentBilling.getTime() + 30 * 86_400_000).toISOString();

    const updatedSub: QASubscriptionFixture = {
      ...subscription,
      status: 'active',
      startedAt: subscription.startedAt,
      nextBillingAt: nextBilling,
    };

    const invoice = SubscriptionQAFactory.createMockInvoice({
      subscriptionId: subscription.id,
      amount: subscription.amount,
      currency: subscription.currency,
      status: 'paid',
      dueAt: currentBilling.toISOString(),
      paidAt: new Date().toISOString(),
    });

    return { subscription: updatedSub, invoice };
  }

  static simulateCancellation(
    subscription: QASubscriptionFixture,
    reason = 'User requested cancellation',
  ): { subscription: QASubscriptionFixture; cancelledAt: string } {
    const cancelledAt = new Date().toISOString();
    const updatedSub: QASubscriptionFixture = {
      ...subscription,
      status: 'cancelled',
      cancellationReason: reason,
    };
    return { subscription: updatedSub, cancelledAt };
  }

  static simulateTrialExpiry(subscription: QASubscriptionFixture): QASubscriptionFixture {
    const now = new Date().toISOString();
    const nextBillingAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    return {
      ...subscription,
      status: 'active',
      startedAt: now,
      nextBillingAt,
      trialEndsAt: undefined,
    };
  }
}

/**
 * Validation & assertion utilities for QA tests.
 */
export class SubscriptionQAAssertions {
  static isValidStatus(status: string): boolean {
    return ['active', 'cancelled', 'paused', 'past_due', 'trialing'].includes(status);
  }

  static validateSubscription(subscription: Partial<QASubscriptionFixture>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!subscription.id) errors.push('Missing subscription id');
    if (!subscription.userId) errors.push('Missing userId');
    if (!subscription.planId) errors.push('Missing planId');

    if (!subscription.status || !SubscriptionQAAssertions.isValidStatus(subscription.status)) {
      errors.push(`Invalid status: ${subscription.status}`);
    }

    if (typeof subscription.amount !== 'number' || Number.isNaN(subscription.amount) || subscription.amount < 0) {
      errors.push('Amount must be a non-negative number');
    }

    if (!subscription.currency || subscription.currency.length !== 3) {
      errors.push('Currency must be a 3-letter ISO code');
    }

    if (subscription.nextBillingAt && Number.isNaN(Date.parse(subscription.nextBillingAt))) {
      errors.push('Invalid nextBillingAt timestamp');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  static isAllowedTransition(
    fromStatus: QASubscriptionFixture['status'],
    toStatus: QASubscriptionFixture['status'],
  ): boolean {
    if (fromStatus === toStatus) return true;

    const transitions: Record<QASubscriptionFixture['status'], QASubscriptionFixture['status'][]> = {
      trialing: ['active', 'cancelled', 'past_due'],
      active: ['paused', 'cancelled', 'past_due'],
      paused: ['active', 'cancelled'],
      past_due: ['active', 'cancelled'],
      cancelled: [], // Terminal state
    };

    return transitions[fromStatus]?.includes(toStatus) ?? false;
  }
}
