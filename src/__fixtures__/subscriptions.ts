import { Subscription, SubscriptionCategory, BillingCycle } from '../types/subscription';

/**
 * Shared test data for component interaction tests.
 *
 * Use these fixtures instead of inlining subscription objects in individual
 * test cases so that the shape stays consistent with the real `Subscription`
 * type across every suite.
 */
export const mockSubscription: Subscription = {
  id: 'test-id-001',
  name: 'Netflix',
  description: 'Streaming service',
  category: SubscriptionCategory.STREAMING,
  price: 15.99,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  nextBillingDate: new Date('2026-06-30T00:00:00.000Z'),
  isActive: true,
  isCryptoEnabled: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

export const mockPausedSubscription: Subscription = {
  id: 'test-id-002',
  name: 'Spotify',
  description: 'Music streaming',
  category: SubscriptionCategory.STREAMING,
  price: 9.99,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  nextBillingDate: new Date('2026-06-15T00:00:00.000Z'),
  isActive: false,
  isCryptoEnabled: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

export const mockSubscriptions: Subscription[] = [
  mockSubscription,
  mockPausedSubscription,
  {
    id: 'test-id-003',
    name: 'iCloud',
    description: 'Cloud storage',
    category: SubscriptionCategory.PRODUCTIVITY,
    price: 2.99,
    currency: 'USD',
    billingCycle: BillingCycle.YEARLY,
    nextBillingDate: new Date('2026-07-01T00:00:00.000Z'),
    isActive: true,
    isCryptoEnabled: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
];
