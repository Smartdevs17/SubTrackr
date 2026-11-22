/**
 * billingSlice.ts — Calendar-based merchant billing schedules and invoices.
 *
 * Issue #2045 — Collapse repeated Zustand stores into feature-scoped slices.
 *
 * The original src/store/billingStore.ts referenced types and service helpers
 * that were never actually defined in the repo (phantom imports). This slice
 * is the production-ready implementation: types are defined here, all business
 * logic is self-contained, and nothing depends on missing modules.
 *
 * Persisted fields (whitelisted in partialize): billingSchedules, billingInvoices.
 * Ephemeral fields (excluded): billingIsLoading, billingError.
 */

import { SliceCreator } from './types';
import type { AppState } from './state';

// ─────────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────────

/** What to do when an anchor day falls on a short month (e.g. Feb 30). */
export type AdjustmentPolicy = 'skip' | 'last_day' | 'next_month';

/**
 * Configuration a merchant provides when opting into calendar-aligned billing.
 * `anchorDay` is the day-of-month on which billing fires (1–28 to be safe
 * across all months; 29–31 are accepted but governed by `adjustmentPolicy`).
 */
export interface CalendarBilling {
  provider: 'google' | 'apple' | 'outlook' | 'manual';
  /** Day of month on which billing anchors (1–31). */
  anchorDay: number;
  /** How many calendar months per cycle (1 = monthly, 3 = quarterly, 12 = annual). */
  billingCycleMonths: number;
  adjustmentPolicy: AdjustmentPolicy;
}

/** Resolved billing schedule stored per-merchant. */
export interface MerchantBillingSchedule {
  merchantId: string;
  config: CalendarBilling;
  /** ISO-8601 datetime of the upcoming billing event. */
  nextBillingDate: string;
  /** ISO-8601 datetime of the last billing event, if any. */
  lastBillingDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Status an invoice may be in. */
export type InvoiceStatus = 'draft' | 'pending' | 'paid' | 'void' | 'refunded';

/** A generated billing invoice for one subscription period. */
export interface CalendarInvoice {
  id: string;
  subscriptionId: string;
  merchantId: string;
  periodStart: string;
  periodEnd: string;
  billingDate: string;
  /** Billed amount (may be pro-rated if joinDate was provided). */
  amount: number;
  currency: string;
  status: InvoiceStatus;
  isProRated: boolean;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (testable without the store)
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve the next billing date after `from` given a CalendarBilling config. */
export function calculateNextBillingDate(config: CalendarBilling, from: Date): Date {
  const result = new Date(from);
  result.setDate(1); // avoid month-overflow while advancing
  result.setMonth(result.getMonth() + config.billingCycleMonths);

  // Apply anchor day, respecting the adjustment policy
  const daysInMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  if (config.anchorDay > daysInMonth) {
    switch (config.adjustmentPolicy) {
      case 'last_day':
        result.setDate(daysInMonth);
        break;
      case 'next_month':
        // Roll into the first day of the following month
        result.setMonth(result.getMonth() + 1);
        result.setDate(1);
        break;
      default: // 'skip' — stay at the last valid day this month
        result.setDate(daysInMonth);
        break;
    }
  } else {
    result.setDate(config.anchorDay);
  }

  result.setHours(0, 0, 0, 0);
  return result;
}

/** Build an initial schedule from today. */
function buildSchedule(
  merchantId: string,
  config: CalendarBilling,
  now: Date
): MerchantBillingSchedule {
  const next = calculateNextBillingDate(config, now);
  const iso = now.toISOString();
  return {
    merchantId,
    config,
    nextBillingDate: next.toISOString(),
    lastBillingDate: null,
    createdAt: iso,
    updatedAt: iso,
  };
}

/** Advance a schedule by one billing cycle. */
function advanceSchedule(schedule: MerchantBillingSchedule): MerchantBillingSchedule {
  const next = calculateNextBillingDate(schedule.config, new Date(schedule.nextBillingDate));
  const now = new Date().toISOString();
  return {
    ...schedule,
    lastBillingDate: schedule.nextBillingDate,
    nextBillingDate: next.toISOString(),
    updatedAt: now,
  };
}

/**
 * Calculate a pro-rated amount for a subscriber who joined mid-period.
 * Returns the full amount if `joinDate` is on or before `periodStart`.
 */
export function calculateProRataAmount(
  fullAmount: number,
  periodStart: Date,
  periodEnd: Date,
  joinDate: Date
): number {
  const totalMs = periodEnd.getTime() - periodStart.getTime();
  if (totalMs <= 0) return fullAmount;

  const joinMs = Math.max(joinDate.getTime() - periodStart.getTime(), 0);
  if (joinMs <= 0) return fullAmount;

  const fraction = 1 - joinMs / totalMs;
  return Math.round(fullAmount * fraction * 100) / 100;
}

let invoiceSeq = 0;

function generateInvoice(params: {
  subscriptionId: string;
  merchantId: string;
  periodStart: Date;
  periodEnd: Date;
  billingDate: Date;
  amount: number;
  currency: string;
  joinDate?: Date;
}): CalendarInvoice {
  const isProRated = params.joinDate != null;
  const amount = isProRated
    ? calculateProRataAmount(params.amount, params.periodStart, params.periodEnd, params.joinDate!)
    : params.amount;

  invoiceSeq += 1;
  const id = `inv_${Date.now()}_${invoiceSeq}_${Math.random().toString(36).slice(2, 7)}`;

  return {
    id,
    subscriptionId: params.subscriptionId,
    merchantId: params.merchantId,
    periodStart: params.periodStart.toISOString(),
    periodEnd: params.periodEnd.toISOString(),
    billingDate: params.billingDate.toISOString(),
    amount,
    currency: params.currency,
    status: 'draft',
    isProRated,
    createdAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Slice interface
// ─────────────────────────────────────────────────────────────────────────────

export interface BillingSlice {
  billingSchedules: Record<string, MerchantBillingSchedule>;
  billingInvoices: Record<string, CalendarInvoice>;
  billingIsLoading: boolean;
  billingError: string | null;

  setMerchantCalendarBilling: (merchantId: string, config: CalendarBilling) => void;
  removeMerchantCalendarBilling: (merchantId: string) => void;
  getNextBillingDate: (merchantId: string) => Date | null;
  advanceBillingSchedule: (merchantId: string) => void;
  generateBillingInvoice: (params: {
    subscriptionId: string;
    merchantId: string;
    periodStart: Date;
    periodEnd: Date;
    billingDate: Date;
    amount: number;
    currency: string;
    joinDate?: Date;
  }) => CalendarInvoice;
  updateBillingInvoiceStatus: (invoiceId: string, status: InvoiceStatus) => void;
  getInvoicesForSubscription: (subscriptionId: string) => CalendarInvoice[];
  getInvoicesForMerchant: (merchantId: string) => CalendarInvoice[];
  calculateProRata: (
    fullAmount: number,
    periodStart: Date,
    periodEnd: Date,
    joinDate: Date
  ) => number;
  clearBillingError: () => void;
}

export type BillingStoreState = AppState & BillingSlice;

// ─────────────────────────────────────────────────────────────────────────────
// Slice creator
// ─────────────────────────────────────────────────────────────────────────────

export const createBillingSlice: SliceCreator<BillingSlice> = (set, get) => ({
  billingSchedules: {},
  billingInvoices: {},
  billingIsLoading: false,
  billingError: null,

  setMerchantCalendarBilling: (merchantId, config) => {
    try {
      const schedule = buildSchedule(merchantId, config, new Date());
      set((state) => ({
        billingSchedules: { ...state.billingSchedules, [merchantId]: schedule },
        billingError: null,
      }));
    } catch (err) {
      set({
        billingError: err instanceof Error ? err.message : 'Failed to set billing schedule.',
      });
    }
  },

  removeMerchantCalendarBilling: (merchantId) => {
    set((state) => {
      const next = { ...state.billingSchedules };
      delete next[merchantId];
      return { billingSchedules: next };
    });
  },

  getNextBillingDate: (merchantId) => {
    const schedule = get().billingSchedules[merchantId];
    if (!schedule) return null;
    return new Date(schedule.nextBillingDate);
  },

  advanceBillingSchedule: (merchantId) => {
    const schedule = get().billingSchedules[merchantId];
    if (!schedule) return;
    const advanced = advanceSchedule(schedule);
    set((state) => ({
      billingSchedules: { ...state.billingSchedules, [merchantId]: advanced },
    }));
  },

  generateBillingInvoice: (params) => {
    const invoice = generateInvoice(params);
    set((state) => ({
      billingInvoices: { ...state.billingInvoices, [invoice.id]: invoice },
    }));
    return invoice;
  },

  updateBillingInvoiceStatus: (invoiceId, status) => {
    set((state) => {
      const invoice = state.billingInvoices[invoiceId];
      if (!invoice) return state;
      return {
        billingInvoices: {
          ...state.billingInvoices,
          [invoiceId]: { ...invoice, status },
        },
      };
    });
  },

  getInvoicesForSubscription: (subscriptionId) =>
    Object.values(get().billingInvoices)
      .filter((inv) => inv.subscriptionId === subscriptionId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),

  getInvoicesForMerchant: (merchantId) =>
    Object.values(get().billingInvoices)
      .filter((inv) => inv.merchantId === merchantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),

  calculateProRata: (fullAmount, periodStart, periodEnd, joinDate) =>
    calculateProRataAmount(fullAmount, periodStart, periodEnd, joinDate),

  clearBillingError: () => set({ billingError: null }),
});
