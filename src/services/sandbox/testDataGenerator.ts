import { TestDataConfig, SandboxEnvironment } from '../../types/sandbox';
import { Subscription, SubscriptionCategory, BillingCycle } from '../../types/subscription';

const DEFAULT_TEST_CONFIG: TestDataConfig = {
  subscriptions: 10,
  categories: Object.values(SubscriptionCategory),
  priceRange: { min: 5, max: 100 },
  billingCycles: Object.values(BillingCycle),
  currencies: ['USD', 'EUR', 'GBP', 'JPY'],
  includeInactive: true,
  includeCrypto: true,
};

const SAMPLE_SUBSCRIPTION_NAMES: Record<SubscriptionCategory, string[]> = {
  [SubscriptionCategory.STREAMING]: [
    'Netflix',
    'Disney+',
    'Hulu',
    'HBO Max',
    'Apple TV+',
    'Paramount+',
  ],
  [SubscriptionCategory.SOFTWARE]: [
    'Adobe Creative Cloud',
    'Microsoft 365',
    'Slack',
    'Notion',
    'Figma',
  ],
  [SubscriptionCategory.GAMING]: [
    'Xbox Game Pass',
    'PlayStation Plus',
    'Nintendo Online',
    'EA Play',
    'Steam',
  ],
  [SubscriptionCategory.PRODUCTIVITY]: ['Todoist', 'Evernote', 'Asana', 'Trello', 'Monday.com'],
  [SubscriptionCategory.FITNESS]: [
    'Peloton',
    'Fitbit Premium',
    'Strava',
    'MyFitnessPal',
    'Headspace',
  ],
  [SubscriptionCategory.EDUCATION]: [
    'Coursera',
    'Udemy',
    'MasterClass',
    'Duolingo Plus',
    'Skillshare',
  ],
  [SubscriptionCategory.FINANCE]: [
    'Mint Premium',
    'YNAB',
    'Robinhood Gold',
    'Bloomberg',
    'TradingView',
  ],
  [SubscriptionCategory.OTHER]: [
    'Amazon Prime',
    'Costco',
    "Sam's Club",
    'Box Subscription',
    'Custom Service',
  ],
};

const CRYPTO_TOKENS = ['ETH', 'USDC', 'DAI', 'WBTC', 'MATIC'];

class TestDataGenerator {
  private static instance: TestDataGenerator;

  private constructor() {}

  static getInstance(): TestDataGenerator {
    if (!TestDataGenerator.instance) {
      TestDataGenerator.instance = new TestDataGenerator();
    }
    return TestDataGenerator.instance;
  }

  generateSubscriptions(config: Partial<TestDataConfig> = {}): Subscription[] {
    const fullConfig = { ...DEFAULT_TEST_CONFIG, ...config };
    const subscriptions: Subscription[] = [];

    for (let i = 0; i < fullConfig.subscriptions; i++) {
      const category = this.randomFromArray(fullConfig.categories as SubscriptionCategory[]);
      const name = this.randomFromArray(SAMPLE_SUBSCRIPTION_NAMES[category] || ['Test Service']);
      const isActive = fullConfig.includeInactive ? Math.random() > 0.2 : true;
      const isCryptoEnabled = fullConfig.includeCrypto ? Math.random() > 0.7 : false;

      const subscription: Subscription = {
        id: `test_sub_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}`,
        name,
        description: `Test subscription for ${name}`,
        category,
        price: this.randomPrice(fullConfig.priceRange.min, fullConfig.priceRange.max),
        currency: this.randomFromArray(fullConfig.currencies),
        billingCycle: this.randomFromArray(
          fullConfig.billingCycles as BillingCycle[]
        ) as BillingCycle,
        nextBillingDate: this.randomFutureDate(),
        isActive,
        notificationsEnabled: Math.random() > 0.3,
        isCryptoEnabled,
        cryptoToken: isCryptoEnabled ? this.randomFromArray(CRYPTO_TOKENS) : undefined,
        cryptoAmount: isCryptoEnabled ? this.randomPrice(0.001, 1) : undefined,
        createdAt: this.randomPastDate(),
        updatedAt: new Date(),
      };

      subscriptions.push(subscription);
    }

    return subscriptions;
  }

  generateSandboxSubscriptions(environment: SandboxEnvironment): Subscription[] {
    const configs: Record<SandboxEnvironment, Partial<TestDataConfig>> = {
      [SandboxEnvironment.DEVELOPMENT]: {
        subscriptions: 15,
        includeInactive: true,
        includeCrypto: true,
      },
      [SandboxEnvironment.STAGING]: {
        subscriptions: 25,
        includeInactive: true,
        includeCrypto: true,
      },
      [SandboxEnvironment.TESTING]: {
        subscriptions: 5,
        includeInactive: false,
        includeCrypto: false,
      },
    };

    return this.generateSubscriptions(configs[environment]);
  }

  private randomFromArray<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  private randomPrice(min: number, max: number): number {
    return Math.round((min + Math.random() * (max - min)) * 100) / 100;
  }

  private randomFutureDate(): Date {
    const now = new Date();
    const daysToAdd = Math.floor(Math.random() * 365) + 1;
    return new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  }

  private randomPastDate(): Date {
    const now = new Date();
    const daysToSubtract = Math.floor(Math.random() * 365) + 1;
    return new Date(now.getTime() - daysToSubtract * 24 * 60 * 60 * 1000);
  }

  generateUsageData(subscriptionCount: number): {
    date: Date;
    requests: number;
    errors: number;
    avgResponseTime: number;
  }[] {
    const data = [];
    const now = new Date();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const baseRequests = subscriptionCount * 10;
      const variance = Math.floor(Math.random() * baseRequests * 0.3);

      data.push({
        date,
        requests: baseRequests + variance,
        errors: Math.floor(Math.random() * (variance * 0.1)),
        avgResponseTime: 50 + Math.floor(Math.random() * 200),
      });
    }

    return data;
  }
}

export const testDataGenerator = TestDataGenerator.getInstance();
