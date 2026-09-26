import { Subscription } from '../types/subscription';
import {
  AlignmentHistoryEntry,
  AlignmentPlanPreview,
  AlignmentTargetDay,
  ConsolidationGroup,
  REALIGNMENT_LOCKOUT_DAYS,
  SubscriptionAlignmentPreview,
} from '../types/billingAlignment';
import { getPeriodDays } from './proration';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Finds the next occurrence of `targetDay` on or after `from`. If `from` is
 * already on the target day, returns `from` unchanged (no-op alignment).
 */
export function nearestAlignedDate(from: Date, targetDay: AlignmentTargetDay): Date {
  const year = from.getFullYear();
  const month = from.getMonth();
  const day = from.getDate();

  if (day === targetDay) {
    return new Date(from);
  }

  if (day < targetDay) {
    const candidate = new Date(year, month, targetDay);
    // Guard against month overflow (e.g. target day 31 doesn't exist) — not
    // possible for day 1/15, but keep this safe for future target days.
    if (candidate.getMonth() === month) return candidate;
  }

  // Otherwise roll forward to the target day next month.
  return new Date(year, month + 1, targetDay);
}

/** Computes the prorated true-up amount for shifting a subscription's billing date. */
export function calculateAlignmentPreview(
  subscription: Subscription,
  targetDay: AlignmentTargetDay
): SubscriptionAlignmentPreview {
  const currentBillingDate = new Date(subscription.nextBillingDate);
  const alignedBillingDate = nearestAlignedDate(currentBillingDate, targetDay);
  const daysShifted = Math.round(
    (alignedBillingDate.getTime() - currentBillingDate.getTime()) / DAY_MS
  );

  const isFree = subscription.price <= 0;
  const periodDays = getPeriodDays(subscription.billingCycle);
  const dailyRate = subscription.price / periodDays;
  const proratedAmount = isFree ? 0 : Math.round(Math.abs(dailyRate * daysShifted) * 100) / 100;

  return {
    subscriptionId: subscription.id,
    subscriptionName: subscription.name,
    billingCycle: subscription.billingCycle,
    currentBillingDate,
    alignedBillingDate,
    daysShifted,
    proratedAmount,
    isCredit: daysShifted < 0,
    excludedReason: isFree ? 'free_subscription' : undefined,
  };
}

/** Builds a full alignment plan for every active subscription, excluding free ones. */
export function buildAlignmentPlanPreview(
  subscriptions: Subscription[],
  targetDay: AlignmentTargetDay
): AlignmentPlanPreview {
  const previews = subscriptions
    .filter((s) => s.isActive)
    .map((s) => calculateAlignmentPreview(s, targetDay));

  const billable = previews.filter((p) => !p.excludedReason);
  const totalCharge = round2(
    billable.filter((p) => !p.isCredit).reduce((sum, p) => sum + p.proratedAmount, 0)
  );
  const totalCredit = round2(
    billable.filter((p) => p.isCredit).reduce((sum, p) => sum + p.proratedAmount, 0)
  );
  const netAmount = round2(totalCharge - totalCredit);

  return {
    targetDay,
    previews,
    totalCharge,
    totalCredit,
    netAmount: Math.abs(netAmount),
    isNetCredit: netAmount < 0,
  };
}

/** 90-day re-alignment lockout (issue #566 acceptance criterion). */
export function canRealign(lastAlignedAt: Date | null, now: Date = new Date()): boolean {
  if (!lastAlignedAt) return true;
  const daysSince = (now.getTime() - new Date(lastAlignedAt).getTime()) / DAY_MS;
  return daysSince >= REALIGNMENT_LOCKOUT_DAYS;
}

export function daysUntilNextRealignment(
  lastAlignedAt: Date | null,
  now: Date = new Date()
): number {
  if (!lastAlignedAt) return 0;
  const daysSince = (now.getTime() - new Date(lastAlignedAt).getTime()) / DAY_MS;
  return Math.max(0, Math.ceil(REALIGNMENT_LOCKOUT_DAYS - daysSince));
}

export function buildHistoryEntry(
  targetDay: AlignmentTargetDay,
  subscriptionIds: string[],
  alignedAt: Date = new Date()
): AlignmentHistoryEntry {
  return { alignedAt, targetDay, subscriptionIds };
}

/** Groups already-aligned, paid, active subscriptions by shared billing date for consolidation. */
export function groupForConsolidation(subscriptions: Subscription[]): ConsolidationGroup[] {
  const groups = new Map<string, string[]>();

  for (const sub of subscriptions) {
    if (!sub.isActive || sub.price <= 0) continue;
    const key = new Date(sub.nextBillingDate).toISOString().slice(0, 10);
    const ids = groups.get(key) ?? [];
    ids.push(sub.id);
    groups.set(key, ids);
  }

  return Array.from(groups.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([billingDateKey, subscriptionIds]) => ({ billingDateKey, subscriptionIds }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
