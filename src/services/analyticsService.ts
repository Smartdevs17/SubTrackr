import { BillingCycle, Subscription } from '../types/subscription';

export interface RevenuePoint {
  label: string;
  mrr: number;
  arr: number;
}

export interface ChurnMetrics {
  grossChurnRate: number;
  netChurnRate: number;
  churnedSubscriptions: number;
  activeSubscriptions: number;
}

export interface CohortMetric {
  cohort: string;
  subscriptionsStarted: number;
  activeSubscriptions: number;
  retentionRate: number;
  revenue: number;
}

export interface RevenueForecastPoint {
  label: string;
  expectedRevenue: number;
  lowerBound: number;
  upperBound: number;
}

export interface SubscriptionAnalyticsReport {
  mrr: number;
  arr: number;
  ltv: number;
  churn: ChurnMetrics;
  revenueTrend: RevenuePoint[];
  cohorts: CohortMetric[];
  forecast: RevenueForecastPoint[];
}

const MONTHS_PER_YEAR = 12;
const WEEKS_PER_MONTH = 4.345;

export const toMonthlyRevenue = (
  subscription: Pick<Subscription, 'price' | 'billingCycle'>
): number => {
  if (subscription.billingCycle === BillingCycle.YEARLY)
    return subscription.price / MONTHS_PER_YEAR;
  if (subscription.billingCycle === BillingCycle.WEEKLY)
    return subscription.price * WEEKS_PER_MONTH;
  return subscription.price;
};

const monthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export const calculateSubscriptionAnalytics = (
  subscriptions: Subscription[],
  asOf = new Date()
): SubscriptionAnalyticsReport => {
  const active = subscriptions.filter((subscription) => subscription.isActive);
  const inactive = subscriptions.filter((subscription) => !subscription.isActive);
  const mrr = active.reduce((sum, subscription) => sum + toMonthlyRevenue(subscription), 0);
  const arr = mrr * MONTHS_PER_YEAR;
  const churnDenominator = Math.max(subscriptions.length, 1);
  const grossChurnRate = inactive.length / churnDenominator;
  const expansionRevenue = active.reduce((sum, subscription) => {
    const createdAt = new Date(subscription.createdAt);
    return createdAt < asOf ? sum + Math.max(0, toMonthlyRevenue(subscription) * 0.03) : sum;
  }, 0);
  const churnedRevenue = inactive.reduce(
    (sum, subscription) => sum + toMonthlyRevenue(subscription),
    0
  );
  const netChurnRate =
    mrr + churnedRevenue > 0
      ? Math.max(0, (churnedRevenue - expansionRevenue) / (mrr + churnedRevenue))
      : 0;
  const averageMonthlyRevenue = active.length ? mrr / active.length : 0;
  const ltv =
    grossChurnRate > 0
      ? averageMonthlyRevenue / grossChurnRate
      : averageMonthlyRevenue * MONTHS_PER_YEAR;

  const cohorts = Array.from(
    subscriptions.reduce((map, subscription) => {
      const key = monthKey(new Date(subscription.createdAt));
      const entries = map.get(key) ?? [];
      entries.push(subscription);
      map.set(key, entries);
      return map;
    }, new Map<string, Subscription[]>())
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohort, entries]) => {
      const activeSubscriptions = entries.filter((subscription) => subscription.isActive).length;
      return {
        cohort,
        subscriptionsStarted: entries.length,
        activeSubscriptions,
        retentionRate: entries.length ? activeSubscriptions / entries.length : 0,
        revenue: entries.reduce((sum, subscription) => sum + toMonthlyRevenue(subscription), 0),
      };
    });

  const revenueTrend = cohorts.slice(-6).map((cohort) => ({
    label: cohort.cohort,
    mrr: cohort.revenue,
    arr: cohort.revenue * MONTHS_PER_YEAR,
  }));

  const retention = cohorts.length
    ? cohorts.reduce((sum, cohort) => sum + cohort.retentionRate, 0) / cohorts.length
    : 1;
  const confidenceBand = Math.max(0.1, 1 - Math.min(subscriptions.length / 50, 0.8));
  const forecast = Array.from({ length: 3 }, (_, index) => {
    const monthAhead = index + 1;
    const expectedRevenue = mrr * Math.pow(retention || 0.95, monthAhead);
    return {
      label: `M+${monthAhead}`,
      expectedRevenue,
      lowerBound: expectedRevenue * (1 - confidenceBand),
      upperBound: expectedRevenue * (1 + confidenceBand),
    };
  });

  return {
    mrr,
    arr,
    ltv,
    churn: {
      grossChurnRate,
      netChurnRate,
      churnedSubscriptions: inactive.length,
      activeSubscriptions: active.length,
    },
    revenueTrend,
    cohorts,
    forecast,
  };
};
