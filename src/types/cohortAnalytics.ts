/**
 * Shared types for the advanced subscription analytics suite (cohort retention,
 * revenue vs. logo churn, plan migration, LTV by acquisition source).
 *
 * Decoupled from the personal `Subscription` model — analytics operate on
 * merchant-side subscriber lifecycle records, mirroring the shape already used
 * by the webhook subsystem (see src/types/webhook.ts WebhookSubscriptionSnapshot).
 */

export type CohortGranularity = 'week' | 'month';

export interface PlanChangeEvent {
  fromPlanId: string;
  toPlanId: string;
  changedAt: number;
}

export interface SubscriberRecord {
  subscriberId: string;
  merchantId: string;
  planId: string;
  planName: string;
  region?: string;
  acquisitionChannel?: string;
  /** Epoch ms the subscriber's first subscription started. */
  signupAt: number;
  /** Epoch ms the subscriber churned; undefined if still active. */
  churnedAt?: number;
  /** Current monthly recurring revenue contribution. */
  mrr: number;
  /** Epoch ms of the subscriber's last observed activity, used for activity-based retention. */
  lastActiveAt?: number;
  planHistory?: PlanChangeEvent[];
}

export interface CohortBucket {
  /** e.g. "2026-W07" or "2026-06" depending on granularity. */
  cohortKey: string;
  granularity: CohortGranularity;
  periodStart: number;
  periodEnd: number;
  size: number;
  activeCount: number;
  retentionRate: number;
  startingMrr: number;
  currentMrr: number;
  isEmpty: boolean;
}

export interface RetentionCurvePoint {
  day: 1 | 7 | 30 | 60 | 90;
  retainedCount: number;
  cohortSize: number;
  retentionRate: number;
}

export interface ChurnBreakdown {
  periodStart: number;
  periodEnd: number;
  startingSubscribers: number;
  churnedSubscribers: number;
  logoChurnRate: number;
  startingMrr: number;
  churnedMrr: number;
  revenueChurnRate: number;
  isEmpty: boolean;
}

export interface PlanMigrationFlow {
  fromPlanId: string;
  toPlanId: string;
  count: number;
  direction: 'upgrade' | 'downgrade' | 'lateral';
}

export interface LtvSourceBreakdown {
  acquisitionChannel: string;
  subscriberCount: number;
  avgLifetimeMonths: number;
  avgMonthlyRevenue: number;
  ltv: number;
}

export interface AnomalyFlaggedPoint {
  label: string;
  value: number;
  isAnomaly: boolean;
}

export interface ChurnRiskSummary {
  cohortKey: string;
  sampledSubscribers: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  averageChurnProbability: number;
}

export type AnalyticsExportFormat = 'csv' | 'pdf';
