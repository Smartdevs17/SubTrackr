/**
 * Test data factories for integration tests.
 * Provides deterministic, minimal fixtures for subscriptions, wallets, and streams.
 */

import { SubscriptionCategory, BillingCycle } from '../../../src/types/subscription';
import type { Subscription, SubscriptionFormData } from '../../../src/types/subscription';
import type { Wallet, CryptoStream } from '../../../src/types/wallet';

let _idCounter = 0;
const nextId = () => `test-${++_idCounter}`;

export function resetIdCounter(): void {
  _idCounter = 0;
}

export function makeSubscriptionFormData(
  overrides: Partial<SubscriptionFormData> = {}
): SubscriptionFormData {
  return {
    name: 'Test Service',
    category: SubscriptionCategory.SOFTWARE,
    price: 9.99,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date('2026-05-01'),
    notificationsEnabled: true,
    isCryptoEnabled: false,
    ...overrides,
  };
}

export function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  const now = new Date('2026-04-01T00:00:00Z');
  return {
    id: nextId(),
    name: 'Test Service',
    category: SubscriptionCategory.SOFTWARE,
    price: 9.99,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date('2026-05-01'),
    isActive: true,
    notificationsEnabled: true,
    isCryptoEnabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeWallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fAb1',
    chainId: 1,
    isConnected: true,
    balance: '1.0',
    tokens: [
      {
        symbol: 'ETH',
        name: 'Ethereum',
        address: '0x0000000000000000000000000000000000000000',
        balance: '1.0',
        decimals: 18,
      },
    ],
    ...overrides,
  };
}

export function makeCryptoStream(overrides: Partial<CryptoStream> = {}): CryptoStream {
  return {
    id: nextId(),
    subscriptionId: nextId(),
    token: 'USDC',
    amount: 10,
    flowRate: '0.001',
    startDate: new Date('2026-04-01'),
    isActive: true,
    protocol: 'superfluid',
    streamId: `stream_${nextId()}`,
    ...overrides,
  };
}
