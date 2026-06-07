import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  advanceMerchantBillingSchedule,
  calculateNextBillingDate,
  calculateProRataAmount,
  generateCalendarInvoice,
  setCalendarBilling,
} from '../services/calendarService';
import type {
  AdjustmentPolicy,
  CalendarBilling,
  CalendarInvoice,
  MerchantBillingSchedule,
} from '../types/calendar';

const STORAGE_KEY = 'subtrackr-billing-schedules';

// ── State shape ────────────────────────────────────────────────────────────

interface BillingState {
  /** Per-merchant calendar billing schedules, keyed by merchantId. */
  schedules: Record<string, MerchantBillingSchedule>;
  /** Generated invoices, keyed by invoice id. */
  invoices: Record<string, CalendarInvoice>;
  isLoading: boolean;
  error: string | null;

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Create or replace the calendar billing config for a merchant.
   * Immediately calculates the next billing date from today.
   */
  setMerchantCalendarBilling: (merchantId: string, config: CalendarBilling) => void;

  /**
   * Remove a merchant's calendar billing schedule.
   */
  removeMerchantCalendarBilling: (merchantId: string) => void;

  /**
   * Get the next billing date for a merchant given their current config.
   * Returns null if no schedule exists.
   */
  getNextBillingDate: (merchantId: string) => Date | null;

  /**
   * Advance a merchant's schedule to the next period (call after a successful charge).
   */
  advanceSchedule: (merchantId: string) => void;

  /**
   * Generate a draft invoice for a subscription billing period.
   * Handles pro-rata calculation when joinDate is provided.
   */
  generateInvoice: (params: {
    subscriptionId: string;
    merchantId: string;
    periodStart: Date;
    periodEnd: Date;
    billingDate: Date;
    amount: number;
    currency: string;
    joinDate?: Date;
  }) => CalendarInvoice;

  /**
   * Update an invoice's status.
   */
  updateInvoiceStatus: (invoiceId: string, status: CalendarInvoice['status']) => void;

  /**
   * Get all invoices for a subscription, sorted newest first.
   */
  getInvoicesForSubscription: (subscriptionId: string) => CalendarInvoice[];

  /**
   * Get all invoices for a merchant, sorted newest first.
   */
  getInvoicesForMerchant: (merchantId: string) => CalendarInvoice[];

  /**
   * Calculate a pro-rata amount for a mid-period subscription start.
   */
  calculateProRata: (
    fullAmount: number,
    periodStart: Date,
    periodEnd: Date,
    joinDate: Date
  ) => number;

  clearError: () => void;
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useBillingStore = create<BillingState>()(
  persist(
    (set, get) => ({
      schedules: {},
      invoices: {},
      isLoading: false,
      error: null,

      setMerchantCalendarBilling: (merchantId, config) => {
        try {
          const schedule = setCalendarBilling(merchantId, config, new Date());
          set((state) => ({
            schedules: { ...state.schedules, [merchantId]: schedule },
            error: null,
          }));
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Failed to set billing schedule.' });
        }
      },

      removeMerchantCalendarBilling: (merchantId) => {
        set((state) => {
          const next = { ...state.schedules };
          delete next[merchantId];
          return { schedules: next };
        });
      },

      getNextBillingDate: (merchantId) => {
        const schedule = get().schedules[merchantId];
        if (!schedule) return null;
        return new Date(schedule.nextBillingDate);
      },

      advanceSchedule: (merchantId) => {
        const schedule = get().schedules[merchantId];
        if (!schedule) return;
        const advanced = advanceMerchantBillingSchedule(schedule);
        set((state) => ({
          schedules: { ...state.schedules, [merchantId]: advanced },
        }));
      },

      generateInvoice: ({ subscriptionId, merchantId, periodStart, periodEnd, billingDate, amount, currency, joinDate }) => {
        const invoice = generateCalendarInvoice(
          subscriptionId,
          merchantId,
          periodStart,
          periodEnd,
          billingDate,
          amount,
          currency,
          joinDate
        );
        set((state) => ({
          invoices: { ...state.invoices, [invoice.id]: invoice },
        }));
        return invoice;
      },

      updateInvoiceStatus: (invoiceId, status) => {
        set((state) => {
          const invoice = state.invoices[invoiceId];
          if (!invoice) return state;
          return {
            invoices: {
              ...state.invoices,
              [invoiceId]: { ...invoice, status },
            },
          };
        });
      },

      getInvoicesForSubscription: (subscriptionId) => {
        return Object.values(get().invoices)
          .filter((inv) => inv.subscriptionId === subscriptionId)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      },

      getInvoicesForMerchant: (merchantId) => {
        return Object.values(get().invoices)
          .filter((inv) => inv.merchantId === merchantId)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      },

      calculateProRata: (fullAmount, periodStart, periodEnd, joinDate) => {
        return calculateProRataAmount(fullAmount, periodStart, periodEnd, joinDate);
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        schedules: state.schedules,
        invoices: state.invoices,
      }),
    }
  )
);

// ── Re-export types for convenience ───────────────────────────────────────
export type { AdjustmentPolicy, CalendarBilling, CalendarInvoice, MerchantBillingSchedule };

// ── Utility re-exports ────────────────────────────────────────────────────
export { calculateNextBillingDate };
