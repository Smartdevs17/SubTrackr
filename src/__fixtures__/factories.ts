import { Subscription, SubscriptionCategory, BillingCycle } from '../types/subscription';

export interface UserFixture {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export interface WalletFixture {
  address: string;
  chainType: 'EVM' | 'STELLAR';
  balance: string;
}

export interface TransactionFixture {
  id: string;
  hash: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  createdAt: Date;
}

export const createMockUser = (overrides?: Partial<UserFixture>): UserFixture => ({
  id: 'usr-test-101',
  email: 'testuser@subtrackr.app',
  name: 'Test User',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

export const createMockSubscription = (overrides?: Partial<Subscription>): Subscription => ({
  id: 'sub-test-202',
  name: 'Github Copilot',
  description: 'AI pair programmer',
  category: SubscriptionCategory.DEVELOPER_TOOLS,
  price: 10.0,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  nextBillingDate: new Date('2026-08-01T00:00:00.000Z'),
  isActive: true,
  isCryptoEnabled: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

export const createMockWallet = (overrides?: Partial<WalletFixture>): WalletFixture => ({
  address: '0x1234567890abcdef1234567890abcdef12345678',
  chainType: 'EVM',
  balance: '100.0',
  ...overrides,
});

export const createMockTransaction = (
  overrides?: Partial<TransactionFixture>
): TransactionFixture => ({
  id: 'tx-test-303',
  hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  amount: 15.99,
  currency: 'USDC',
  status: 'CONFIRMED',
  createdAt: new Date('2026-07-26T00:00:00.000Z'),
  ...overrides,
});
