/**
 * Shared types for the lifecycle module.
 *
 * Covers all subscription state-transition concepts: cancellation, pause,
 * trial, renewal, event bus, event store, and lock integration.
 */

// ── Subscription state ────────────────────────────────────────────────────────

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'paused'
  | 'cancelled'
  | 'past_due'
  | 'unpaid'
  | 'expired';

// ── Cancellation ──────────────────────────────────────────────────────────────

export type CancellationMode = 'immediate' | 'end_of_period';

export type CancellationReason =
  | 'too_expensive'
  | 'not_using'
  | 'missing_features'
  | 'found_alternative'
  | 'poor_experience'
  | 'technical_issues'
  | 'payment_expired'
  | (string & {});

export interface CancellationRequest {
  subscriptionId: string;
  mode: CancellationMode;
  reason?: CancellationReason;
  feedback?: string;
  cancelledBy?: string;
}

export interface CancellationResult {
  subscriptionId: string;
  mode: CancellationMode;
  effectiveAt: number;
  cancelledAt: number;
}

// ── Pause / resume ────────────────────────────────────────────────────────────

export type PauseReason = 'vacation' | 'financial_hardship' | 'temporary_need' | 'other';

export interface PauseRequest {
  subscriptionId: string;
  pauseDays: number;
  reason?: PauseReason;
  price: number;
  currency: string;
  periodDays: number;
}

export interface PauseResult {
  subscriptionId: string;
  pausedAt: number;
  resumeAt: number;
  creditAmount: number;
  currency: string;
}

export interface ResumeRequest {
  subscriptionId: string;
  creditAmount: number;
  pauseDays: number;
  daysElapsed: number;
}

export interface ResumeResult {
  subscriptionId: string;
  resumedAt: number;
  unusedCredit: number;
  currency: string;
}

// ── Trial ─────────────────────────────────────────────────────────────────────

export type TrialStatus = 'active' | 'converted' | 'expired' | 'cancelled';

export interface TrialRecord {
  id: string;
  subscriptionId: string;
  planId: string;
  userId: string;
  status: TrialStatus;
  durationDays: number;
  startedAt: number;
  endsAt: number;
  convertedAt?: number;
  cancelledAt?: number;
}

export interface StartTrialRequest {
  subscriptionId: string;
  planId: string;
  userId: string;
  durationDays?: number;
}

export interface ConvertTrialRequest {
  subscriptionId: string;
  targetPlanId?: string;
}

// ── Renewal ───────────────────────────────────────────────────────────────────

export interface RenewalRequest {
  subscriptionId: string;
  billedAt?: number;
}

export interface RenewalResult {
  subscriptionId: string;
  renewedAt: number;
  nextBillingAt: number;
}

// ── Event store types ─────────────────────────────────────────────────────────

export type LifecycleEventType =
  | 'subscription.created'
  | 'subscription.cancelled'
  | 'subscription.renewed'
  | 'subscription.upgraded'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'subscription.trial_started'
  | 'subscription.trial_converted'
  | 'subscription.trial_expired'
  | 'subscription.payment_failed';

export interface LifecycleEvent<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  subscriptionId: string;
  sequence: number;
  type: LifecycleEventType;
  payload: TPayload;
  occurredAt: number;
  schemaVersion: number;
  archivedAt?: number;
}

// ── SLA ───────────────────────────────────────────────────────────────────────

export type SlaMetricKind =
  | 'uptime'
  | 'response_time'
  | 'error_rate'
  | 'latency'
  | 'throughput';

export type SubscriptionTier = 'free' | 'basic' | 'standard' | 'premium' | 'enterprise';

export interface SlaTarget {
  uptimeTarget: number;
  maxResponseTimeMs: number;
  maxErrorRate: number;
  maxLatencyMs: number;
  creditPercentage: number;
}

export interface SlaBreachRecord {
  id: string;
  subscriptionId: string;
  tier: SubscriptionTier;
  metricKind: SlaMetricKind;
  targetValue: number;
  actualValue: number;
  deviationPercent: number;
  creditIssued: number;
  detectedAt: number;
  resolvedAt: number | null;
}
