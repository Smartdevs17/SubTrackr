import { resolvers } from '../resolvers';

describe('GraphQL Subscription Reporting API Resolvers', () => {
  const mockSubscriptions = [
    {
      id: 'sub_1',
      userId: 'usr_100',
      name: 'Pro Monthly Plan',
      amount: 29.99,
      currency: 'USD',
      billingCycle: 'monthly',
      status: 'active',
    },
    {
      id: 'sub_2',
      userId: 'usr_101',
      name: 'Enterprise Annual Plan',
      amount: 240.0,
      currency: 'USD',
      billingCycle: 'annual', // 20/mo
      status: 'active',
    },
    {
      id: 'sub_3',
      userId: 'usr_102',
      name: 'Basic Monthly Plan',
      amount: 9.99,
      currency: 'USD',
      billingCycle: 'monthly',
      status: 'canceled',
    },
    {
      id: 'sub_4',
      userId: 'usr_103',
      name: 'Pro Monthly Plan',
      amount: 29.99,
      currency: 'USD',
      billingCycle: 'monthly',
      status: 'trial',
    },
  ];

  const mockPool = {
    query: jest.fn().mockImplementation(async (sql: string, params: any[]) => {
      if (params && params.length > 0) {
        const filtered = mockSubscriptions.filter((s) => s.userId === params[0]);
        return { rows: filtered };
      }
      return { rows: mockSubscriptions };
    }),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('subscriptionReport resolver', () => {
    test('computes aggregated metrics correctly for all subscriptions', async () => {
      const resolver = (resolvers.Query as any).subscriptionReport;
      const report = await resolver(
        {},
        { startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-31T23:59:59Z' },
        { pool: mockPool }
      );

      expect(report.totalActiveSubscriptions).toBe(2);
      expect(report.totalCanceledSubscriptions).toBe(1);
      expect(report.totalTrialSubscriptions).toBe(1);
      // sub1: 29.99/mo, sub2: 240/12 = 20/mo => MRR = 49.99
      expect(report.monthlyRecurringRevenue).toBe(49.99);
      expect(report.annualRecurringRevenue).toBe(599.88); // 49.99 * 12
      expect(report.currency).toBe('USD');
      expect(report.churnRate).toBeGreaterThan(0);
      expect(report.averageRevenuePerUser).toBe(25.0); // 49.99 / 2
      expect(report.breakdownByStatus.length).toBeGreaterThan(0);
      expect(report.breakdownByPlan.length).toBeGreaterThan(0);
    });

    test('filters report by userId', async () => {
      const resolver = (resolvers.Query as any).subscriptionReport;
      const report = await resolver({}, { userId: 'usr_100' }, { pool: mockPool });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1'),
        ['usr_100']
      );
      expect(report.totalActiveSubscriptions).toBe(1);
      expect(report.monthlyRecurringRevenue).toBe(29.99);
    });
  });

  describe('subscriptionAnalytics resolver', () => {
    test('resolves analytics for specified period', async () => {
      const resolver = (resolvers.Query as any).subscriptionAnalytics;
      const analytics = await resolver({}, { period: '7d' }, { pool: mockPool });

      expect(analytics.monthlyRecurringRevenue).toBe(49.99);
      expect(analytics.periodStart).toBeDefined();
      expect(analytics.periodEnd).toBeDefined();
    });
  });
});
