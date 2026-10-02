/**
 * accountingStore – revenue recognition accounting state (ASC 606 / IFRS 15).
 *
 * Implements:
 *  - RevenueRecognitionRule (method + recognition_period)
 *  - Straight-line and usage-based recognition
 *  - Deferred revenue tracking
 *  - Revenue schedule generation
 *  - Multi-element arrangement accounting
 *  - Revenue analytics by period
 *  - Contract modifications (upgrade/downgrade) → schedule re-creation
 *  - Early termination with revenue acceleration
 *  - Free-trial support (zero revenue until conversion)
 *  - CSV / JSON export for ERP integration (QuickBooks, Xero)
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
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

/** Represents an audit journal entry for ASC 606 compliance. */
export interface RevenueJournalEntry {
  id: string;
  subscriptionId: string;
  merchantId: string;
  type:
    'charge' | 'recognition' | 'modification' | 'termination' | 'acceleration' | 'trial_conversion';
  amount: number;
  debitAccount: string;
  creditAccount: string;
  timestamp: number; // Unix ms
  description: string;
}

/** Waterfall row for the Revenue Report: deferred / recognised / realised. */
export interface RevenueWaterfallRow {
  subscriptionId: string;
  subscriptionName: string;
  totalCharged: number;
  recognised: number;
  deferred: number;
  realised: number; // recognised that has passed its period end
}

/** Contract modification descriptor. */
export interface ContractModification {
  type: 'upgrade' | 'downgrade';
  newAmount: number;
  newBillingCycle: BillingCycle;
  effectiveDate: number; // Unix ms
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
  /** ASC 606 audit journal entries. */
  journalEntries: RevenueJournalEntry[];
  /** Subscriptions currently in a free-trial period (subscriptionId → trialEndDate ms). */
  trialSubscriptions: Record<string, number>;

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

  // ── ASC 606 extended features ──

  /**
   * Handle a contract modification (upgrade/downgrade).
   * Re-schedules remaining deferred revenue prospectively from effectiveDate.
   */
  applyContractModification: (
    subscriptionId: string,
    modification: ContractModification,
    merchantId?: string
  ) => RevenueSchedule;

  /**
   * Accelerate deferred revenue on early termination.
   * All remaining deferred entries become recognised immediately.
   */
  applyEarlyTermination: (
    subscriptionId: string,
    terminationDate: number,
    merchantId?: string
  ) => void;

  /**
   * Mark a subscription as being in a free-trial period.
   * No revenue is generated; schedule is zero until conversion.
   */
  startFreeTrial: (subscriptionId: string, trialEndDate: number) => void;

  /**
   * Convert a trial subscription — generate the real revenue schedule from today.
   */
  convertTrialToActive: (
    subscriptionId: string,
    totalAmount: number,
    billingCycle: BillingCycle,
    merchantId?: string
  ) => RevenueSchedule;

  /** Returns all journal entries, optionally filtered by subscriptionId or merchantId. */
  getJournalEntries: (filter?: {
    subscriptionId?: string;
    merchantId?: string;
  }) => RevenueJournalEntry[];

  /** Compute a revenue waterfall for the given subscriptionIds (or all if omitted). */
  getRevenueWaterfall: (
    subscriptionIds?: string[],
    subscriptionNames?: Record<string, string>
  ) => RevenueWaterfallRow[];

  /**
   * Export the revenue waterfall as CSV (string) or JSON (string).
   */
  exportWaterfall: (
    format: 'csv' | 'json',
    subscriptionIds?: string[],
    subscriptionNames?: Record<string, string>
  ) => string;
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
    recognisedAmount: i === numPeriods - 1 ? Math.round((slice + remainder) * 100) / 100 : slice,
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

let _journalSeq = 0;
function nextJournalId(): string {
  return `jrn-${Date.now().toString(36)}-${(++_journalSeq).toString(36)}`;
}

const initialState = {
  rules: {} as Record<string, RevenueRecognitionRule>,
  schedules: {} as Record<string, RevenueSchedule>,
  deferredRevenue: {} as Record<string, number>,
  recognisedRevenue: {} as Record<string, number>,
  journalEntries: [] as RevenueJournalEntry[],
  trialSubscriptions: {} as Record<string, number>, // subscriptionId → trialEndDate
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

        // Skip revenue generation for active free-trial subscriptions.
        const trialEnd = get().trialSubscriptions[subscriptionId];
        if (trialEnd !== undefined && chargeDate < trialEnd) {
          const schedule = buildStraightLineSchedule(subscriptionId, 0, chargeDate, intervalMs, 1);
          set((state) => ({
            schedules: { ...state.schedules, [subscriptionId]: schedule },
          }));
          return schedule;
        }

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

        const journalEntry: RevenueJournalEntry = {
          id: nextJournalId(),
          subscriptionId,
          merchantId,
          type: 'charge',
          amount: totalAmount,
          debitAccount: 'Cash',
          creditAccount: 'Deferred Revenue',
          timestamp: chargeDate,
          description: `Charge $${totalAmount.toFixed(2)} deferred on billing cycle start`,
        };

        set((state) => ({
          schedules: { ...state.schedules, [subscriptionId]: schedule },
          // All newly charged revenue starts as deferred.
          deferredRevenue: {
            ...state.deferredRevenue,
            [merchantId]: (state.deferredRevenue[merchantId] ?? 0) + totalAmount,
          },
          journalEntries: [...state.journalEntries, journalEntry],
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

      // ── ASC 606 extended features ────────────────────────────────────────────

      applyContractModification: (subscriptionId, modification, merchantId = DEFAULT_MERCHANT) => {
        const now = modification.effectiveDate;
        const newIntervalMs = billingCycleToMs(modification.newBillingCycle);
        const rule = get().rules[subscriptionId];

        // Build a fresh schedule from the modification effective date.
        let newSchedule: RevenueSchedule;
        if (rule?.method === 'usage-based') {
          newSchedule = buildUsageBasedSchedule(
            subscriptionId,
            modification.newAmount,
            now,
            newIntervalMs
          );
        } else {
          const periodMs = rule?.recognitionPeriodMs ?? newIntervalMs;
          const numPeriods = Math.max(1, Math.ceil(newIntervalMs / periodMs));
          newSchedule = buildStraightLineSchedule(
            subscriptionId,
            modification.newAmount,
            now,
            periodMs,
            numPeriods
          );
        }

        const journalEntry: RevenueJournalEntry = {
          id: nextJournalId(),
          subscriptionId,
          merchantId,
          type: 'modification',
          amount: modification.newAmount,
          debitAccount: 'Deferred Revenue',
          creditAccount: 'Revenue',
          timestamp: now,
          description: `Contract ${modification.type} to $${modification.newAmount.toFixed(2)} — schedule re-created prospectively`,
        };

        set((state) => ({
          schedules: { ...state.schedules, [subscriptionId]: newSchedule },
          deferredRevenue: {
            ...state.deferredRevenue,
            [merchantId]: (state.deferredRevenue[merchantId] ?? 0) + modification.newAmount,
          },
          journalEntries: [...state.journalEntries, journalEntry],
        }));

        return newSchedule;
      },

      applyEarlyTermination: (subscriptionId, terminationDate, merchantId = DEFAULT_MERCHANT) => {
        const schedule = get().schedules[subscriptionId];
        if (!schedule) return;

        // Accelerate: mark every future entry as recognised at terminationDate.
        const { deferred } = splitRecognisedDeferred(schedule, terminationDate);
        if (deferred <= 0) return;

        const acceleratedEntries: RevenueScheduleEntry[] = schedule.entries.map((entry) => {
          if (terminationDate >= entry.periodEnd) return entry;
          if (terminationDate < entry.periodStart) {
            // Fully future — recognise the whole entry immediately.
            return { ...entry, periodEnd: terminationDate, isRecognised: true };
          }
          // Partially elapsed — recognise remaining.
          return { ...entry, periodEnd: terminationDate, isRecognised: true };
        });

        const acceleratedSchedule: RevenueSchedule = {
          ...schedule,
          entries: acceleratedEntries,
        };

        const journalEntry: RevenueJournalEntry = {
          id: nextJournalId(),
          subscriptionId,
          merchantId,
          type: 'acceleration',
          amount: deferred,
          debitAccount: 'Deferred Revenue',
          creditAccount: 'Revenue',
          timestamp: terminationDate,
          description: `Early termination — $${deferred.toFixed(2)} deferred revenue accelerated`,
        };

        set((state) => ({
          schedules: { ...state.schedules, [subscriptionId]: acceleratedSchedule },
          recognisedRevenue: {
            ...state.recognisedRevenue,
            [merchantId]: (state.recognisedRevenue[merchantId] ?? 0) + deferred,
          },
          deferredRevenue: {
            ...state.deferredRevenue,
            [merchantId]: Math.max(0, (state.deferredRevenue[merchantId] ?? 0) - deferred),
          },
          journalEntries: [...state.journalEntries, journalEntry],
        }));
      },

      startFreeTrial: (subscriptionId, trialEndDate) => {
        set((state) => ({
          trialSubscriptions: {
            ...state.trialSubscriptions,
            [subscriptionId]: trialEndDate,
          },
        }));
      },

      convertTrialToActive: (
        subscriptionId,
        totalAmount,
        billingCycle,
        merchantId = DEFAULT_MERCHANT
      ) => {
        const conversionDate = Date.now();

        // Remove from trial tracking.
        set((state) => {
          const trialSubscriptions = { ...state.trialSubscriptions };
          delete trialSubscriptions[subscriptionId];
          return { trialSubscriptions };
        });

        const journalEntry: RevenueJournalEntry = {
          id: nextJournalId(),
          subscriptionId,
          merchantId,
          type: 'trial_conversion',
          amount: totalAmount,
          debitAccount: 'Cash',
          creditAccount: 'Deferred Revenue',
          timestamp: conversionDate,
          description: `Trial conversion — $${totalAmount.toFixed(2)} charged, recognition schedule created`,
        };

        set((state) => ({
          journalEntries: [...state.journalEntries, journalEntry],
        }));

        return get().generateRevenueSchedule(
          subscriptionId,
          totalAmount,
          conversionDate,
          billingCycle,
          merchantId
        );
      },

      getJournalEntries: (filter) => {
        const entries = get().journalEntries;
        if (!filter) return entries;
        return entries.filter(
          (e) =>
            (!filter.subscriptionId || e.subscriptionId === filter.subscriptionId) &&
            (!filter.merchantId || e.merchantId === filter.merchantId)
        );
      },

      getRevenueWaterfall: (subscriptionIds, subscriptionNames = {}) => {
        const now = Date.now();
        const ids = subscriptionIds ?? Object.keys(get().schedules);
        return ids.map((subscriptionId) => {
          const schedule = get().schedules[subscriptionId];
          if (!schedule) {
            return {
              subscriptionId,
              subscriptionName: subscriptionNames[subscriptionId] ?? subscriptionId,
              totalCharged: 0,
              recognised: 0,
              deferred: 0,
              realised: 0,
            };
          }
          const { recognised, deferred } = splitRecognisedDeferred(schedule, now);
          const realised = schedule.entries
            .filter((e) => e.periodEnd <= now)
            .reduce((sum, e) => sum + e.recognisedAmount, 0);
          return {
            subscriptionId,
            subscriptionName: subscriptionNames[subscriptionId] ?? subscriptionId,
            totalCharged: schedule.totalAmount,
            recognised,
            deferred,
            realised,
          };
        });
      },

      exportWaterfall: (format, subscriptionIds, subscriptionNames) => {
        const rows = get().getRevenueWaterfall(subscriptionIds, subscriptionNames);
        if (format === 'json') return JSON.stringify(rows, null, 2);

        // CSV export
        const header = 'Subscription ID,Name,Total Charged,Recognised,Deferred,Realised';
        const lines = rows.map(
          (r) =>
            `"${r.subscriptionId}","${r.subscriptionName}",${r.totalCharged.toFixed(2)},${r.recognised.toFixed(2)},${r.deferred.toFixed(2)},${r.realised.toFixed(2)}`
        );
        return [header, ...lines].join('\n');
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
    }
  )
);
