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

export interface RetentionPoint {
  day: number;
  retainedCount: number;
  cohortSize: number;
  retentionRate: number;
}

export interface SubscriptionAnalyticsReport {
  mrr: number;
  arr: number;
  mrrGrowthRate: number;
  arrGrowthRate: number;
  ltv: number;
  arpu: number;
  subscriberCount: number;
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

export const calculateRetentionCurve = (
  subscriptions: Subscription[],
  asOf = new Date()
): RetentionPoint[] => {
  const intervals = [1, 7, 30, 60, 90];
  const total = subscriptions.length;
  if (total === 0) {
    return intervals.map((day) => ({ day, retainedCount: 0, cohortSize: 0, retentionRate: 0 }));
  }

  const nowMs = asOf.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  return intervals.map((day) => {
    const thresholdMs = nowMs - day * dayMs;
    const eligibleSubs = subscriptions.filter(
      (sub) => new Date(sub.createdAt).getTime() <= thresholdMs
    );
    const retainedCount = eligibleSubs.filter((sub) => sub.isActive).length;
    const retentionRate =
      eligibleSubs.length > 0
        ? retainedCount / eligibleSubs.length
        : subscriptions.filter((s) => s.isActive).length / total;
    return {
      day,
      retainedCount,
      cohortSize: eligibleSubs.length > 0 ? eligibleSubs.length : total,
      retentionRate,
    };
  });
};

export const calculateSubscriptionAnalytics = (
  subscriptions: Subscription[],
  asOf = new Date(),
  forecastModel: 'linear' | 'exponential' = 'exponential',
  monthsAhead = 3
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

  // Calculate MRR/ARR growth rate compared to previous period
  let mrrGrowthRate = 0;
  let arrGrowthRate = 0;
  if (revenueTrend.length >= 2) {
    const prevMrr = revenueTrend[revenueTrend.length - 2].mrr;
    const currMrr = revenueTrend[revenueTrend.length - 1].mrr;
    if (prevMrr > 0) {
      mrrGrowthRate = ((currMrr - prevMrr) / prevMrr) * 100;
      arrGrowthRate = mrrGrowthRate;
    }
  }

  const retention = cohorts.length
    ? cohorts.reduce((sum, cohort) => sum + cohort.retentionRate, 0) / cohorts.length
    : 1;
  const confidenceBand = Math.max(0.1, 1 - Math.min(subscriptions.length / 50, 0.8));

  // Compute linear regression slope if model is 'linear'
  let linearSlope = 0;
  if (forecastModel === 'linear' && revenueTrend.length >= 2) {
    const n = revenueTrend.length;
    const sumX = revenueTrend.reduce((sum, _, i) => sum + i, 0);
    const sumY = revenueTrend.reduce((sum, point) => sum + point.mrr, 0);
    const sumXY = revenueTrend.reduce((sum, point, i) => sum + i * point.mrr, 0);
    const sumXX = revenueTrend.reduce((sum, _, i) => sum + i * i, 0);
    const denominator = n * sumXX - sumX * sumX;
    if (denominator !== 0) {
      linearSlope = (n * sumXY - sumX * sumY) / denominator;
    }
  }

  const forecast = Array.from({ length: monthsAhead }, (_, index) => {
    const monthAhead = index + 1;
    let expectedRevenue = 0;
    if (forecastModel === 'linear') {
      expectedRevenue = Math.max(0, mrr + linearSlope * monthAhead);
    } else {
      expectedRevenue = mrr * Math.pow(retention || 0.95, monthAhead);
    }
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
    mrrGrowthRate,
    arrGrowthRate,
    ltv,
    arpu: averageMonthlyRevenue,
    subscriberCount: active.length,
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
