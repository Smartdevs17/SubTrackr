/**
 * accountingStore – revenue recognition accounting state.
 *
 * Implements:
 *  - RevenueRecognitionRule (method + recognition_period)
 *  - Straight-line and usage-based recognition
 *  - Deferred revenue tracking
 *  - Revenue schedule generation
 *  - Multi-element arrangement accounting
 *  - Revenue analytics by period
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BillingCycle } from '../types/subscription';

// ── Domain types ──────────────────────────────────────────────────────────────

export type RecognitionMethod = 'straight-line' | 'usage-based';

export interface RevenueRecognitionRule {
  /** Subscription ID this rule applies to. */
  subscriptionId: string;
  method: RecognitionMethod;
  /**
   * Length of one recognition period in milliseconds.
   * e.g. 30 * 24 * 60 * 60 * 1000 for 30 days.
   */
  recognitionPeriodMs: number;
}

export interface RevenueScheduleEntry {
  periodStart: number; // Unix ms
  periodEnd: number; // Unix ms
  recognisedAmount: number; // currency units
  isRecognised: boolean;
}

export interface RevenueSchedule {
  subscriptionId: string;
  totalAmount: number;
  chargeDate: number; // Unix ms when the charge occurred
  entries: RevenueScheduleEntry[];
}

export interface Recognition {
  subscriptionId: string;
  recognisedRevenue: number;
  deferredRevenue: number;
  asOf: number; // Unix ms
}

export interface PeriodRevenue {
  periodStart: number; // Unix ms
  periodEnd: number; // Unix ms
  recognisedAmount: number;
  subscriptionCount: number;
}

// ── Store state & actions ─────────────────────────────────────────────────────

interface AccountingState {
  /** Recognition rules keyed by subscriptionId. */
  rules: Record<string, RevenueRecognitionRule>;
  /** Revenue schedules keyed by subscriptionId. */
  schedules: Record<string, RevenueSchedule>;
  /** Cumulative deferred revenue per merchantId (or 'default'). */
  deferredRevenue: Record<string, number>;
  /** Cumulative recognised revenue per merchantId (or 'default'). */
  recognisedRevenue: Record<string, number>;

  // ── Actions ──

  /** Persist a recognition rule for a subscription. */
  setRecognitionRule: (rule: RevenueRecognitionRule) => void;

  /** Remove a recognition rule. */
  removeRecognitionRule: (subscriptionId: string) => void;

  /**
   * Generate and persist a revenue schedule for a charge.
   * @param subscriptionId  Subscription being charged.
   * @param totalAmount     Amount charged (in currency units).
   * @param chargeDate      When the charge occurred (Unix ms).
   * @param billingCycle    Billing cycle of the subscription.
   * @param merchantId      Merchant receiving the revenue.
   */
  generateRevenueSchedule: (
    subscriptionId: string,
    totalAmount: number,
    chargeDate: number,
    billingCycle: BillingCycle,
    merchantId?: string
  ) => RevenueSchedule;

  /**
   * Compute a recognition snapshot for a subscription as of `asOf` (defaults to now).
   */
  recognizeRevenue: (subscriptionId: string, asOf?: number) => Recognition;

  /** Return the cumulative deferred revenue for a merchant. */
  getDeferredRevenue: (merchantId?: string) => number;

  /** Return the revenue schedule for a subscription (or undefined). */
  getRevenueSchedule: (subscriptionId: string) => RevenueSchedule | undefined;

  /**
   * Compute per-period revenue analytics across all tracked subscriptions.
   * @param periodMs  Bucket size in milliseconds.
   * @param from      Range start (Unix ms).
   * @param to        Range end (Unix ms).
   */
  getRevenueAnalyticsByPeriod: (periodMs: number, from: number, to: number) => PeriodRevenue[];

  /** Flush all accounting data (useful for testing). */
  reset: () => void;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Convert a BillingCycle to its duration in milliseconds. */
export function billingCycleToMs(cycle: BillingCycle): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  switch (cycle) {
    case BillingCycle.WEEKLY:
      return 7 * MS_PER_DAY;
    case BillingCycle.MONTHLY:
      // 30.44 average days per month
      return Math.round(30.44 * MS_PER_DAY);
    case BillingCycle.YEARLY:
      return 365 * MS_PER_DAY;
    default:
      return 30 * MS_PER_DAY;
  }
}

/**
 * Build a straight-line schedule: split `totalAmount` evenly across
 * `numPeriods` consecutive periods of `periodMs` ms each.
 * Any rounding remainder is added to the last entry.
 */
export function buildStraightLineSchedule(
  subscriptionId: string,
  totalAmount: number,
  chargeDate: number,
  periodMs: number,
  numPeriods: number
): RevenueSchedule {
  if (numPeriods <= 0) throw new Error('numPeriods must be > 0');
  if (periodMs <= 0) throw new Error('periodMs must be > 0');

  const slice = Math.floor((totalAmount / numPeriods) * 100) / 100;
  const remainder = Math.round((totalAmount - slice * numPeriods) * 100) / 100;

  const entries: RevenueScheduleEntry[] = Array.from({ length: numPeriods }, (_, i) => ({
    periodStart: chargeDate + i * periodMs,
    periodEnd: chargeDate + (i + 1) * periodMs,
    recognisedAmount: i === numPeriods - 1 ? slice + remainder : slice,
    isRecognised: false,
  }));

  return { subscriptionId, totalAmount, chargeDate, entries };
}

/**
 * Build a usage-based schedule: a single entry covering the full interval.
 * Revenue is deferred until the merchant reports actual usage.
 */
export function buildUsageBasedSchedule(
  subscriptionId: string,
  totalAmount: number,
  chargeDate: number,
  intervalMs: number
): RevenueSchedule {
  return {
    subscriptionId,
    totalAmount,
    chargeDate,
    entries: [
      {
        periodStart: chargeDate,
        periodEnd: chargeDate + intervalMs,
        recognisedAmount: totalAmount,
        isRecognised: false,
      },
    ],
  };
}

/**
 * Walk a schedule and return { recognised, deferred } split as of `now`.
 * Partial periods are pro-rated linearly.
 */
export function splitRecognisedDeferred(
  schedule: RevenueSchedule,
  now: number
): { recognised: number; deferred: number } {
  let recognised = 0;
  let deferred = 0;

  for (const entry of schedule.entries) {
    if (now >= entry.periodEnd) {
      recognised += entry.recognisedAmount;
    } else if (now >= entry.periodStart) {
      const elapsed = now - entry.periodStart;
      const duration = entry.periodEnd - entry.periodStart;
      const partial = (entry.recognisedAmount * elapsed) / duration;
      recognised += partial;
      deferred += entry.recognisedAmount - partial;
    } else {
      deferred += entry.recognisedAmount;
    }
  }

  return { recognised, deferred };
}

// ── Store ─────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'subtrackr-accounting';
const DEFAULT_MERCHANT = 'default';

const initialState = {
  rules: {} as Record<string, RevenueRecognitionRule>,
  schedules: {} as Record<string, RevenueSchedule>,
  deferredRevenue: {} as Record<string, number>,
  recognisedRevenue: {} as Record<string, number>,
};

export const useAccountingStore = create<AccountingState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setRecognitionRule: (rule) => {
        set((state) => ({
          rules: { ...state.rules, [rule.subscriptionId]: rule },
        }));
      },

      removeRecognitionRule: (subscriptionId) => {
        set((state) => {
          const rules = { ...state.rules };
          delete rules[subscriptionId];
          return { rules };
        });
      },

      generateRevenueSchedule: (
        subscriptionId,
        totalAmount,
        chargeDate,
        billingCycle,
        merchantId = DEFAULT_MERCHANT
      ) => {
        const rule = get().rules[subscriptionId];
        const intervalMs = billingCycleToMs(billingCycle);

        let schedule: RevenueSchedule;

        if (rule) {
          const numPeriods = Math.max(1, Math.ceil(intervalMs / rule.recognitionPeriodMs));
          if (rule.method === 'straight-line') {
            schedule = buildStraightLineSchedule(
              subscriptionId,
              totalAmount,
              chargeDate,
              rule.recognitionPeriodMs,
              numPeriods
            );
          } else {
            schedule = buildUsageBasedSchedule(subscriptionId, totalAmount, chargeDate, intervalMs);
          }
        } else {
          // Default: straight-line over the full interval as a single period.
          schedule = buildStraightLineSchedule(
            subscriptionId,
            totalAmount,
            chargeDate,
            intervalMs,
            1
          );
        }

        set((state) => ({
          schedules: { ...state.schedules, [subscriptionId]: schedule },
          // All newly charged revenue starts as deferred.
          deferredRevenue: {
            ...state.deferredRevenue,
            [merchantId]: (state.deferredRevenue[merchantId] ?? 0) + totalAmount,
          },
        }));

        return schedule;
      },

      recognizeRevenue: (subscriptionId, asOf = Date.now()) => {
        const schedule = get().schedules[subscriptionId];
        if (!schedule) {
          return {
            subscriptionId,
            recognisedRevenue: 0,
            deferredRevenue: 0,
            asOf,
          };
        }
        const { recognised, deferred } = splitRecognisedDeferred(schedule, asOf);
        return {
          subscriptionId,
          recognisedRevenue: recognised,
          deferredRevenue: deferred,
          asOf,
        };
      },

      getDeferredRevenue: (merchantId = DEFAULT_MERCHANT) => {
        return get().deferredRevenue[merchantId] ?? 0;
      },

      getRevenueSchedule: (subscriptionId) => {
        return get().schedules[subscriptionId];
      },

      getRevenueAnalyticsByPeriod: (periodMs, from, to) => {
        if (periodMs <= 0) throw new Error('periodMs must be > 0');
        if (to < from) throw new Error('to must be >= from');
        if (to === from) return [];

        const numBuckets = Math.ceil((to - from) / periodMs);
        const buckets: PeriodRevenue[] = Array.from({ length: numBuckets }, (_, i) => ({
          periodStart: from + i * periodMs,
          periodEnd: from + (i + 1) * periodMs,
          recognisedAmount: 0,
          subscriptionCount: 0,
        }));

        for (const schedule of Object.values(get().schedules)) {
          let contributed = false;
          for (const entry of schedule.entries) {
            if (entry.periodStart < from || entry.periodStart >= to) continue;
            const bucketIdx = Math.floor((entry.periodStart - from) / periodMs);
            if (bucketIdx >= 0 && bucketIdx < numBuckets) {
              buckets[bucketIdx].recognisedAmount += entry.recognisedAmount;
              if (!contributed) {
                buckets[bucketIdx].subscriptionCount += 1;
                contributed = true;
              }
            }
          }
        }

        return buckets;
      },

      reset: () => set(initialState),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
