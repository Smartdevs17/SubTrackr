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

// ── Detailed MRR & ARR Breakdown (Issue #952) ─────────────────────────────────

export interface MrrMovementBreakdown {
  startingMrr: number;
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnedMrr: number;
  reactivatedMrr: number;
  netNewMrr: number;
  endingMrr: number;
  endingArr: number;
  quickRatio: number; // (New + Expansion) / (Churn + Contraction)
  netRevenueRetentionPercent: number;
}

export interface CohortMatrixRow {
  cohort: string;
  cohortSize: number;
  startingMrr: number;
  periods: number[]; // Retention percentage for Month 0, Month 1, Month 2...
}

export interface CohortAnalysisResult {
  cohortRows: CohortMatrixRow[];
  averagePeriodRetention: number[];
  highestRetentionCohort: string;
  lowestRetentionCohort: string;
}

export interface UnitEconomicsSummary {
  arpu: number;
  ltv: number;
  cac?: number;
  ltvToCacRatio?: number;
  cacPaybackMonths?: number;
  magicNumber?: number;
}

/**
 * Calculates granular MRR movements (New, Expansion, Contraction, Churn, Reactivation, Net New)
 */
export function calculateDetailedMrrBreakdown(
  currentSubscriptions: Subscription[],
  previousSubscriptions: Subscription[] = []
): MrrMovementBreakdown {
  const currentMap = new Map<string, Subscription>(currentSubscriptions.map((s) => [s.id, s]));
  const prevMap = new Map<string, Subscription>(previousSubscriptions.map((s) => [s.id, s]));

  let startingMrr = 0;
  let newMrr = 0;
  let expansionMrr = 0;
  let contractionMrr = 0;
  let churnedMrr = 0;
  let reactivatedMrr = 0;

  // Process previous subscriptions
  for (const prev of previousSubscriptions) {
    const prevMonthly = prev.isActive ? toMonthlyRevenue(prev) : 0;
    if (prev.isActive) {
      startingMrr += prevMonthly;
    }

    const curr = currentMap.get(prev.id);
    if (!curr || !curr.isActive) {
      if (prev.isActive) {
        churnedMrr += prevMonthly;
      }
    } else {
      const currMonthly = toMonthlyRevenue(curr);
      if (!prev.isActive && curr.isActive) {
        reactivatedMrr += currMonthly;
      } else if (currMonthly > prevMonthly) {
        expansionMrr += (currMonthly - prevMonthly);
      } else if (currMonthly < prevMonthly) {
        contractionMrr += (prevMonthly - currMonthly);
      }
    }
  }

  // Process newly added subscriptions
  for (const curr of currentSubscriptions) {
    if (curr.isActive && !prevMap.has(curr.id)) {
      newMrr += toMonthlyRevenue(curr);
    }
  }

  // If no previous state provided, baseline current active as newMrr or startingMrr
  if (previousSubscriptions.length === 0) {
    const active = currentSubscriptions.filter((s) => s.isActive);
    newMrr = active.reduce((sum, s) => sum + toMonthlyRevenue(s), 0);
  }

  const netNewMrr = (newMrr + expansionMrr + reactivatedMrr) - (contractionMrr + churnedMrr);
  const endingMrr = startingMrr + netNewMrr;
  const endingArr = endingMrr * 12;

  const totalLoss = contractionMrr + churnedMrr;
  const totalGain = newMrr + expansionMrr;
  const quickRatio = totalLoss > 0 ? Number((totalGain / totalLoss).toFixed(2)) : totalGain > 0 ? 10 : 0;

  const netRevenueRetentionPercent = startingMrr > 0
    ? Number((((startingMrr + expansionMrr - contractionMrr - churnedMrr) / startingMrr) * 100).toFixed(2))
    : 100;

  return {
    startingMrr: Number(startingMrr.toFixed(2)),
    newMrr: Number(newMrr.toFixed(2)),
    expansionMrr: Number(expansionMrr.toFixed(2)),
    contractionMrr: Number(contractionMrr.toFixed(2)),
    churnedMrr: Number(churnedMrr.toFixed(2)),
    reactivatedMrr: Number(reactivatedMrr.toFixed(2)),
    netNewMrr: Number(netNewMrr.toFixed(2)),
    endingMrr: Number(endingMrr.toFixed(2)),
    endingArr: Number(endingArr.toFixed(2)),
    quickRatio,
    netRevenueRetentionPercent,
  };
}

/**
 * Calculates multi-period cohort retention matrix
 */
export function calculateCohortRetentionMatrix(
  subscriptions: Subscription[],
  referenceDate: Date = new Date(),
  numberOfPeriods: number = 6
): CohortAnalysisResult {
  // Group by signup month
  const cohortGroups = new Map<string, Subscription[]>();

  for (const sub of subscriptions) {
    const d = new Date(sub.createdAt);
    const key = d.toISOString().slice(0, 7); // YYYY-MM
    const group = cohortGroups.get(key) || [];
    group.push(sub);
    cohortGroups.set(key, group);
  }

  const sortedCohorts = Array.from(cohortGroups.keys()).sort();
  const cohortRows: CohortMatrixRow[] = [];

  for (const cohort of sortedCohorts) {
    const subs = cohortGroups.get(cohort)!;
    const cohortSize = subs.length;
    const startingMrr = subs.reduce((acc, s) => acc + toMonthlyRevenue(s), 0);

    const periods: number[] = [];
    const [cYear, cMonth] = cohort.split('-').map(Number);
    const cohortStartDate = new Date(Date.UTC(cYear, cMonth - 1, 1));

    for (let p = 0; p < numberOfPeriods; p++) {
      const periodDate = new Date(Date.UTC(cYear, cMonth - 1 + p, 1));
      if (periodDate > referenceDate) {
        break; // Future period
      }

      if (p === 0) {
        periods.push(100);
      } else {
        // Evaluate active subscriptions at period p
        const retained = subs.filter((s) => s.isActive).length;
        const rate = cohortSize > 0 ? Number(((retained / cohortSize) * 100).toFixed(1)) : 0;
        periods.push(rate);
      }
    }

    cohortRows.push({
      cohort,
      cohortSize,
      startingMrr: Number(startingMrr.toFixed(2)),
      periods,
    });
  }

  // Compute average retention per lifecycle period
  const averagePeriodRetention: number[] = [];
  for (let p = 0; p < numberOfPeriods; p++) {
    const periodRates = cohortRows
      .map((r) => r.periods[p])
      .filter((rate): rate is number => rate !== undefined);

    if (periodRates.length > 0) {
      const avg = periodRates.reduce((a, b) => a + b, 0) / periodRates.length;
      averagePeriodRetention.push(Number(avg.toFixed(1)));
    }
  }

  const sortedByM1 = [...cohortRows].sort((a, b) => (b.periods[1] || 0) - (a.periods[1] || 0));
  const highestRetentionCohort = sortedByM1[0]?.cohort || '';
  const lowestRetentionCohort = sortedByM1[sortedByM1.length - 1]?.cohort || '';

  return {
    cohortRows,
    averagePeriodRetention,
    highestRetentionCohort,
    lowestRetentionCohort,
  };
}

/**
 * Calculates unit economics (ARPU, LTV, CAC Payback)
 */
export function calculateCustomerUnitEconomics(
  subscriptions: Subscription[],
  cacPerUser: number = 50
): UnitEconomicsSummary {
  const active = subscriptions.filter((s) => s.isActive);
  const totalMrr = active.reduce((sum, s) => sum + toMonthlyRevenue(s), 0);
  const arpu = active.length > 0 ? Number((totalMrr / active.length).toFixed(2)) : 0;

  const churnRate = subscriptions.length > 0
    ? (subscriptions.length - active.length) / subscriptions.length
    : 0.05;

  const ltv = churnRate > 0 ? Number((arpu / churnRate).toFixed(2)) : Number((arpu * 24).toFixed(2));
  const ltvToCacRatio = cacPerUser > 0 ? Number((ltv / cacPerUser).toFixed(2)) : undefined;
  const cacPaybackMonths = arpu > 0 ? Number((cacPerUser / arpu).toFixed(1)) : undefined;

  return {
    arpu,
    ltv,
    cac: cacPerUser,
    ltvToCacRatio,
    cacPaybackMonths,
  };
}
