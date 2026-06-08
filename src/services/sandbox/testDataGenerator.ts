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

  // ── Enhanced realistic scenario generators ────────────────────────────────

  /** Generate realistic payment history with trends and seasonality */
  generatePaymentHistory(
    subscriptionCount: number,
    monthsBack: number = 6
  ): {
    month: string;
    totalRevenue: number;
    successfulPayments: number;
    failedPayments: number;
    cryptoRevenue: number;
    fiatRevenue: number;
    refunds: number;
    chargebacks: number;
  }[] {
    const history = [];
    const baseRevenue = subscriptionCount * 25;
    const now = new Date();

    for (let i = monthsBack - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const seasonalFactor = 1 + Math.sin((date.getMonth() / 12) * Math.PI * 2) * 0.15;
      const growthFactor = 1 + (monthsBack - i) * 0.03;
      const revenue = baseRevenue * seasonalFactor * growthFactor;
      const cryptoShare = 0.15 + Math.random() * 0.1;

      history.push({
        month: date.toISOString().substring(0, 7),
        totalRevenue: Math.round(revenue * 100) / 100,
        successfulPayments: Math.round(subscriptionCount * (0.85 + Math.random() * 0.1)),
        failedPayments: Math.round(subscriptionCount * (0.02 + Math.random() * 0.05)),
        cryptoRevenue: Math.round(revenue * cryptoShare * 100) / 100,
        fiatRevenue: Math.round(revenue * (1 - cryptoShare) * 100) / 100,
        refunds: Math.round(subscriptionCount * 0.01),
        chargebacks: Math.round(subscriptionCount * 0.005),
      });
    }

    return history;
  }

  /** Generate virtual wallet balances for sandbox testing */
  generateVirtualBalances(walletCount: number = 3): {
    walletAddress: string;
    balances: { token: string; amount: string; usdValue: number }[];
    totalUsdValue: number;
    label: string;
  }[] {
    const tokens = [
      { symbol: 'USDC', price: 1.0 },
      { symbol: 'ETH', price: 2500 },
      { symbol: 'DAI', price: 1.0 },
      { symbol: 'WBTC', price: 45000 },
      { symbol: 'USDT', price: 1.0 },
    ];

    const labels = ['Primary Wallet', 'Testing Wallet', 'Business Wallet', 'Savings', 'Operations'];
    const wallets = [];

    for (let i = 0; i < walletCount; i++) {
      const balances = tokens.slice(0, 2 + Math.floor(Math.random() * 3)).map((token) => {
        const amount =
          token.price > 100 ? (Math.random() * 2).toFixed(6) : (Math.random() * 10000).toFixed(2);
        return {
          token: token.symbol,
          amount,
          usdValue: Math.round(parseFloat(amount) * token.price * 100) / 100,
        };
      });

      wallets.push({
        walletAddress: `0x${Array.from({ length: 40 }, () =>
          Math.floor(Math.random() * 16).toString(16)
        ).join('')}`,
        balances,
        totalUsdValue: balances.reduce((sum, b) => sum + b.usdValue, 0),
        label: labels[i % labels.length],
      });
    }

    return wallets;
  }

  /** Generate realistic webhook event sequences */
  generateWebhookScenarios(): {
    name: string;
    description: string;
    events: {
      type: string;
      payload: Record<string, unknown>;
      delayMs: number;
    }[];
  }[] {
    return [
      {
        name: 'New Subscription Flow',
        description: 'Customer signs up for a new subscription',
        events: [
          {
            type: 'customer.created',
            payload: { customerId: 'cus_test_001', email: 'customer@example.com' },
            delayMs: 0,
          },
          {
            type: 'subscription.created',
            payload: {
              subscriptionId: 'sub_test_001',
              plan: 'Pro Monthly',
              amount: 29.99,
              currency: 'USD',
            },
            delayMs: 500,
          },
          {
            type: 'payment.succeeded',
            payload: {
              paymentId: 'pay_test_001',
              amount: 29.99,
              method: 'card',
              transactionHash: null,
            },
            delayMs: 2000,
          },
          {
            type: 'invoice.created',
            payload: { invoiceId: 'inv_test_001', amount: 29.99, status: 'paid' },
            delayMs: 3000,
          },
        ],
      },
      {
        name: 'Crypto Payment Flow',
        description: 'Customer pays subscription with cryptocurrency',
        events: [
          {
            type: 'subscription.created',
            payload: {
              subscriptionId: 'sub_test_002',
              plan: 'Enterprise',
              amount: 199.99,
              currency: 'USDC',
            },
            delayMs: 0,
          },
          {
            type: 'payment.processing',
            payload: {
              paymentId: 'pay_test_002',
              token: 'USDC',
              walletAddress: '0x1234...',
              confirmations: 0,
            },
            delayMs: 1000,
          },
          {
            type: 'payment.confirmed',
            payload: {
              paymentId: 'pay_test_002',
              transactionHash: `0x${'a'.repeat(64)}`,
              confirmations: 12,
              gasUsed: 95000,
            },
            delayMs: 15000,
          },
        ],
      },
      {
        name: 'Failed Payment & Recovery',
        description: 'Payment fails then succeeds on retry',
        events: [
          {
            type: 'payment.attempted',
            payload: { paymentId: 'pay_test_003', amount: 9.99 },
            delayMs: 0,
          },
          {
            type: 'payment.failed',
            payload: {
              paymentId: 'pay_test_003',
              reason: 'insufficient_funds',
              retryCount: 1,
            },
            delayMs: 1000,
          },
          {
            type: 'payment.retried',
            payload: { paymentId: 'pay_test_003', retryAttempt: 2 },
            delayMs: 86400000, // 1 day later
          },
          {
            type: 'payment.succeeded',
            payload: { paymentId: 'pay_test_003_recovery', amount: 9.99, recovered: true },
            delayMs: 86402000,
          },
        ],
      },
      {
        name: 'Subscription Cancellation',
        description: 'Customer cancels their subscription',
        events: [
          {
            type: 'subscription.scheduled_cancellation',
            payload: {
              subscriptionId: 'sub_test_004',
              cancelAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              reason: 'too_expensive',
            },
            delayMs: 0,
          },
          {
            type: 'subscription.cancelled',
            payload: {
              subscriptionId: 'sub_test_004',
              effectiveDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              refundAmount: 0,
            },
            delayMs: 30 * 24 * 60 * 60 * 1000,
          },
        ],
      },
    ];
  }

  /** Generate a realistic blockchain transaction history for display */
  generateBlockchainTransactions(count: number = 10): {
    hash: string;
    from: string;
    to: string;
    value: string;
    token: string;
    method: string;
    status: 'confirmed' | 'pending' | 'failed';
    blockNumber: number;
    gasUsed: number;
    timestamp: Date;
  }[] {
    const methods = [
      'createSubscription',
      'processPayment',
      'cancelSubscription',
      'transferTokens',
      'updateSubscription',
    ];
    const tokens = ['USDC', 'ETH', 'DAI', 'USDT'];
    let blockNum = 18_500_000;

    return Array.from({ length: count }, (_, i) => {
      blockNum += Math.floor(Math.random() * 5);
      const method = this.randomFromArray(methods);

      return {
        hash: `0x${Array.from({ length: 64 }, () =>
          Math.floor(Math.random() * 16).toString(16)
        ).join('')}`,
        from: `0x${Array.from({ length: 40 }, () =>
          Math.floor(Math.random() * 16).toString(16)
        ).join('')}`,
        to: `0x${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join(
          ''
        )}`,
        value:
          method === 'transferTokens'
            ? (Math.random() * 100).toFixed(2)
            : (Math.random() * 50).toFixed(2),
        token: this.randomFromArray(tokens),
        method,
        status: Math.random() > 0.1 ? 'confirmed' : Math.random() > 0.5 ? 'pending' : 'failed',
        blockNumber: blockNum,
        gasUsed: Math.floor(45_000 + Math.random() * 155_000),
        timestamp: new Date(Date.now() - i * 3600000 - Math.random() * 86400000),
      };
    });
  }

  /** Generate realistic error scenarios for testing error handling */
  generateErrorScenarios(): {
    scenario: string;
    endpoint: string;
    httpStatus: number;
    errorCode: string;
    message: string;
    sandboxSpecific: boolean;
  }[] {
    return [
      {
        scenario: 'Rate Limit Exceeded',
        endpoint: '/api/v1/subscriptions',
        httpStatus: 429,
        errorCode: 'RATE_LIMIT_EXCEEDED',
        message: 'Sandbox rate limit of 60 req/min exceeded. Production limit is 300 req/min.',
        sandboxSpecific: true,
      },
      {
        scenario: 'Invalid API Key',
        endpoint: '/api/v1/*',
        httpStatus: 401,
        errorCode: 'INVALID_API_KEY',
        message: 'The provided API key is invalid or has been revoked.',
        sandboxSpecific: false,
      },
      {
        scenario: 'Insufficient Virtual Balance',
        endpoint: '/api/v1/payments/crypto',
        httpStatus: 402,
        errorCode: 'INSUFFICIENT_VIRTUAL_BALANCE',
        message: 'Virtual wallet balance too low. Top up in Sandbox Settings.',
        sandboxSpecific: true,
      },
      {
        scenario: 'Sandbox Feature Not Available',
        endpoint: '/api/v1/sla',
        httpStatus: 403,
        errorCode: 'SANDBOX_FEATURE_DISABLED',
        message: 'SLA features are not available in Free tier sandbox. Upgrade to Pro.',
        sandboxSpecific: true,
      },
      {
        scenario: 'Production Endpoint in Sandbox',
        endpoint: '/api/v1/production/*',
        httpStatus: 400,
        errorCode: 'PRODUCTION_IN_SANDBOX',
        message: 'Cannot call production endpoint with sandbox API key.',
        sandboxSpecific: true,
      },
      {
        scenario: 'Blockchain Simulation Error',
        endpoint: '/api/v1/blockchain/transaction',
        httpStatus: 500,
        errorCode: 'BLOCKCHAIN_SIMULATION_ERROR',
        message: 'Mock blockchain node unavailable. This is a sandbox-only error.',
        sandboxSpecific: true,
      },
      {
        scenario: 'Webhook Delivery Failed',
        endpoint: '/api/v1/webhooks/test',
        httpStatus: 502,
        errorCode: 'WEBHOOK_DELIVERY_FAILED',
        message: 'Test webhook endpoint unreachable. Check your webhook URL.',
        sandboxSpecific: false,
      },
    ];
  }
}

export const testDataGenerator = TestDataGenerator.getInstance();
