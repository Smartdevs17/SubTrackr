import type { Subscription } from '../types/subscription';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_IN_WEEK = 7;
const DAYS_IN_MONTH = 30;

export interface TrackingSnapshot {
  overdue: Subscription[];
  dueThisWeek: Subscription[];
  dueThisMonth: Subscription[];
  nextCharge: Subscription | null;
  overdueCount: number;
  dueThisWeekCount: number;
  dueThisMonthSpend: number;
}

function toTime(value: Date | string | number): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function isTrackable(sub: Subscription): boolean {
  return Boolean(sub.isActive) && !sub.isPaused;
}

/**
 * Builds the subscription-tracking snapshot used by the home overview:
 * overdue charges, renewals due in 7 days, and spend coming due this month.
 */
export function buildTrackingSnapshot(
  subscriptions: Subscription[],
  now: Date = new Date()
): TrackingSnapshot {
  const nowTs = now.getTime();
  const weekTs = nowTs + DAYS_IN_WEEK * MS_PER_DAY;
  const monthTs = nowTs + DAYS_IN_MONTH * MS_PER_DAY;

  const trackable = (subscriptions ?? []).filter(isTrackable);

  const overdue = trackable
    .filter((sub) => toTime(sub.nextBillingDate) < nowTs)
    .sort((a, b) => toTime(a.nextBillingDate) - toTime(b.nextBillingDate));

  const dueThisWeek = trackable
    .filter((sub) => {
      const ts = toTime(sub.nextBillingDate);
      return ts >= nowTs && ts <= weekTs;
    })
    .sort((a, b) => toTime(a.nextBillingDate) - toTime(b.nextBillingDate));

  const dueThisMonth = trackable
    .filter((sub) => {
      const ts = toTime(sub.nextBillingDate);
      return ts >= nowTs && ts <= monthTs;
    })
    .sort((a, b) => toTime(a.nextBillingDate) - toTime(b.nextBillingDate));

  const nextCharge = overdue[0] ?? dueThisWeek[0] ?? dueThisMonth[0] ?? null;

  const dueThisMonthSpend = dueThisMonth.reduce((total, sub) => total + (sub.price || 0), 0);

  return {
    overdue,
    dueThisWeek,
    dueThisMonth,
    nextCharge,
    overdueCount: overdue.length,
    dueThisWeekCount: dueThisWeek.length,
    dueThisMonthSpend,
  };
}
