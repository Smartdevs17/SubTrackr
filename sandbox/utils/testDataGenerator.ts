import {
  TestData,
  TestUser,
  TestSubscription,
  TestPayment,
  TestMerchant,
  TestPlan,
} from '../types/sandbox';

const SAMPLE_MERCHANT_NAMES = [
  'CloudStream Pro',
  'DevTools Plus',
  'DataVault Premium',
  'Music Unlimited',
  'Fitness Hub',
  'Learning Platform',
  'Storage Cloud',
  'VPN Shield',
];

const SAMPLE_PLAN_NAMES = ['Basic', 'Standard', 'Premium', 'Enterprise'];

const SAMPLE_FEATURES = [
  ['Basic features', 'Email support'],
  ['Standard features', 'Priority support', 'API access'],
  ['Premium features', '24/7 support', 'API access', 'Custom integrations'],
  ['Enterprise features', 'Dedicated support', 'Full API access', 'Custom integrations', 'SLA'],
];

export class TestDataGenerator {
  static generateFullTestData(): TestData {
    const merchants = this.generateMerchants(4);
    const users = this.generateUsers(10);
    const subscriptions = this.generateSubscriptions(users, merchants, 20);
    const payments = this.generatePayments(subscriptions, 50);

    return { users, subscriptions, payments, merchants };
  }

  static generateUsers(count: number): TestUser[] {
    const users: TestUser[] = [];
    const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'company.io'];

    for (let i = 0; i < count; i++) {
      const firstName = this.randomFrom([
        'Alice',
        'Bob',
        'Charlie',
        'Diana',
        'Eve',
        'Frank',
        'Grace',
        'Henry',
        'Ivy',
        'Jack',
      ]);
      const lastName = this.randomFrom([
        'Smith',
        'Johnson',
        'Williams',
        'Brown',
        'Jones',
        'Garcia',
        'Miller',
        'Davis',
      ]);
      const domain = this.randomFrom(domains);

      users.push({
        id: crypto.randomUUID(),
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@${domain}`,
        name: `${firstName} ${lastName}`,
        walletAddress: this.generateWalletAddress(),
        createdAt: this.randomDate(180),
      });
    }

    return users;
  }

  static generateMerchants(count: number): TestMerchant[] {
    const merchants: TestMerchant[] = [];
    const shuffledNames = [...SAMPLE_MERCHANT_NAMES].sort(() => Math.random() - 0.5);

    for (let i = 0; i < count; i++) {
      const name = shuffledNames[i];
      const plans = this.generatePlans(3 + Math.floor(Math.random() * 2));

      merchants.push({
        id: crypto.randomUUID(),
        name,
        email: `support@${name.toLowerCase().replace(/\s+/g, '')}.com`,
        walletAddress: this.generateWalletAddress(),
        plans,
      });
    }

    return merchants;
  }

  static generatePlans(count: number): TestPlan[] {
    const plans: TestPlan[] = [];
    const intervals: TestPlan['interval'][] = ['monthly', 'yearly'];
    const currencies = ['USD', 'EUR', 'ETH'];

    for (let i = 0; i < count; i++) {
      const baseAmount = (i + 1) * 9.99;
      const currency = this.randomFrom(currencies);
      const amount = currency === 'ETH' ? baseAmount / 3000 : baseAmount;

      plans.push({
        id: crypto.randomUUID(),
        name: SAMPLE_PLAN_NAMES[i] || `Plan ${i + 1}`,
        amount: Math.round(amount * 100) / 100,
        currency,
        interval: this.randomFrom(intervals),
        features: SAMPLE_FEATURES[i] || SAMPLE_FEATURES[0],
      });
    }

    return plans;
  }

  static generateSubscriptions(
    users: TestUser[],
    merchants: TestMerchant[],
    count: number
  ): TestSubscription[] {
    const subscriptions: TestSubscription[] = [];
    const statuses: TestSubscription['status'][] = ['active', 'paused', 'cancelled'];

    for (let i = 0; i < count; i++) {
      const user = this.randomFrom(users);
      const merchant = this.randomFrom(merchants);
      const plan = this.randomFrom(merchant.plans);
      const status = this.randomFrom(statuses);
      const createdAt = this.randomDate(90);

      const nextBillingDate = new Date(createdAt);
      if (plan.interval === 'monthly') {
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
      } else if (plan.interval === 'yearly') {
        nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
      } else if (plan.interval === 'weekly') {
        nextBillingDate.setDate(nextBillingDate.getDate() + 7);
      } else {
        nextBillingDate.setDate(nextBillingDate.getDate() + 1);
      }

      subscriptions.push({
        id: crypto.randomUUID(),
        userId: user.id,
        merchantId: merchant.id,
        plan: plan.name,
        amount: plan.amount,
        currency: plan.currency,
        status,
        nextBillingDate,
        createdAt,
      });
    }

    return subscriptions;
  }

  static generatePayments(subscriptions: TestSubscription[], count: number): TestPayment[] {
    const payments: TestPayment[] = [];
    const statuses: TestPayment['status'][] = [
      'completed',
      'completed',
      'completed',
      'pending',
      'failed',
    ];

    for (let i = 0; i < count; i++) {
      const subscription = this.randomFrom(subscriptions);
      const status = this.randomFrom(statuses);

      payments.push({
        id: crypto.randomUUID(),
        subscriptionId: subscription.id,
        userId: subscription.userId,
        amount: subscription.amount,
        currency: subscription.currency,
        status,
        transactionHash: this.generateTransactionHash(),
        createdAt: this.randomDate(60),
      });
    }

    return payments;
  }

  private static randomFrom<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  private static randomDate(daysBack: number): Date {
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(Math.random() * daysBack));
    date.setHours(Math.floor(Math.random() * 24));
    date.setMinutes(Math.floor(Math.random() * 60));
    return date;
  }

  private static generateWalletAddress(): string {
    const chars = '0123456789abcdef';
    let address = '0x';
    for (let i = 0; i < 40; i++) {
      address += chars[Math.floor(Math.random() * chars.length)];
    }
    return address;
  }

  private static generateTransactionHash(): string {
    const chars = '0123456789abcdef';
    let hash = '0x';
    for (let i = 0; i < 64; i++) {
      hash += chars[Math.floor(Math.random() * chars.length)];
    }
    return hash;
  }
}
