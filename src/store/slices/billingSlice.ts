/**
 * Billing Slice – core subscription, invoice, tax, accounting, usage,
 * and cancellation state & actions.
 *
 * This slice combines the following domains that are tightly coupled in
 * billing workflows: Subscription, Invoice, Tax, Accounting, Usage, Cancellation.
 */
import type { StateCreator } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Subscription,
  SubscriptionFormData,
  SubscriptionStats,
  SubscriptionCategory,
  BillingCycle,
  SubscriptionTier,
} from '../../types/subscription';
import {
  Invoice,
  InvoiceConfig,
  InvoiceFormData,
  InvoiceStatus,
  InvoiceTotals,
  TaxJurisdiction,
  CustomerTaxStatus,
  TaxRemittanceReport,
  TaxRemittanceLineItem,
  TaxType,
  DigitalGoodsClass,
  TaxRateEntry,
  MidCycleTaxChange,
  TaxInvoiceGenerationInput,
  buildJurisdictionKey,
  isTaxExempt as checkIsTaxExempt,
  DEFAULT_INVOICE_CONFIG,
} from '../../types/invoice';
import { UsageRecord, Quota, QuotaMetric, QuotaStatus } from '../../types/usage';
import { TaxConfig, TaxRate, TaxAmount, TaxCalculationInput, TaxReport, RemittanceScheduleEntry } from '../../types/tax';
import {
  RevenueRecognitionRule,
  RevenueSchedule,
  Recognition,
  PeriodRevenue,
  RecognitionMethod,
  RevenueScheduleEntry,
} from './billingAccoutingTypes';
import { dummySubscriptions } from '../../utils/dummyData';
import { advanceBillingDate } from '../../utils/billingDate';
import { buildInvoice, calculateInvoiceTotals } from '../../utils/invoice';
import { BILLING_CONVERSIONS, CACHE_CONSTANTS } from '../../utils/constants/values';
import {
  buildTaxReport,
  calculateTaxAmount,
  scheduleTaxRemittance,
} from '../../services/taxService';
import {
  previewProration,
  calculateNetProration,
  generateCreditMemo,
  applyCreditMemo,
  ProrationPreview,
  CreditMemo,
} from '../../utils/proration';
import { errorHandler, AppError } from '../../services/errorHandler';
import {
  syncRenewalReminders,
  presentChargeSuccessNotification,
  presentChargeFailedNotification,
  presentDunningRetryNotification,
  presentDunningWarningNotification,
  presentDunningSuspendedNotification,
  presentDunningCancelledNotification,
  presentDunningRecoveryNotification,
  presentLocalNotification,
} from '../../services/notificationService';

// ── Shared helper types inline (to avoid circular deps) ──────────────────

export type RecognitionMethod_ = RecognitionMethod;
export type RevenueSchedule_ = RevenueSchedule;
export type Recognition_ = Recognition;
export type PeriodRevenue_ = PeriodRevenue;
export type RevenueRecognitionRule_ = RevenueRecognitionRule;

// ── Subscription types ───────────────────────────────────────────────────

export interface SubscriptionSlice {
  // State
  subscriptions: Subscription[];
  stats: SubscriptionStats;
  isLoading: boolean;
  error: AppError | null;
  prorationPreview: ProrationPreview | null;
  creditMemos: Record<string, CreditMemo>;
  // Actions
  addSubscription: (data: SubscriptionFormData) => Promise<void>;
  updateSubscription: (id: string, data: Partial<Subscription>) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  toggleSubscriptionStatus: (id: string) => Promise<void>;
  previewPlanChange: (id: string, newPrice: number, effectiveDate: 'immediate' | 'end_of_period') => ProrationPreview;
  executePlanChange: (id: string, newPlanData: Partial<Subscription>, effectiveDate: 'immediate' | 'end_of_period') => Promise<void>;
  applyCreditToSubscription: (id: string) => Promise<void>;
  recordBillingOutcome: (id: string, outcome: 'success' | 'failed') => Promise<void>;
  fetchSubscriptions: () => Promise<void>;
  calculateStats: () => void;
}

// ── Invoice types ────────────────────────────────────────────────────────

export interface InvoiceSlice {
  invoices: Invoice[];
  invoiceConfig: InvoiceConfig;
  nextSequence: number;
  invoiceLoading: boolean;
  invoiceError: AppError | null;
  taxRates: TaxRateEntry[];
  customerTaxStatuses: Record<string, CustomerTaxStatus>;
  taxRemittanceLines: TaxRemittanceLineItem[];
  taxRemittanceReports: TaxRemittanceReport[];
  digitalGoodsClasses: Record<string, DigitalGoodsClass>;
  generateInvoiceFromSubscription: (data: InvoiceFormData, taxRateBps?: number, exchangeRate?: number) => Promise<Invoice>;
  generateTaxInvoice: (input: TaxInvoiceGenerationInput) => Promise<Invoice>;
  updateInvoiceStatus: (id: string, status: InvoiceStatus) => Promise<void>;
  voidInvoice: (id: string) => Promise<void>;
  sendInvoice: (id: string, recipientEmail?: string) => Promise<void>;
  markInvoicePaid: (id: string) => Promise<void>;
  setTaxRate: (region: string, taxRateBps: number) => void;
  setTaxJurisdiction: (entry: TaxRateEntry) => void;
  removeTaxJurisdiction: (jurisdictionKey: string) => void;
  setExchangeRate: (currency: string, exchangeRate: number) => void;
  calculateTotals: (id: string) => InvoiceTotals | null;
  setCustomerTaxStatus: (subscriberId: string, status: CustomerTaxStatus) => void;
  removeCustomerTaxStatus: (subscriberId: string) => void;
  isCustomerTaxExempt: (subscriberId: string, jurisdictionKey: string) => boolean;
  validateTaxCertificate: (subscriberId: string, certificateId: string) => boolean;
  lookupTaxRate: (jurisdiction: TaxJurisdiction, digitalGoodsClass?: DigitalGoodsClass) => TaxRateEntry | null;
  resolveEffectiveTaxRateBps: (jurisdiction: TaxJurisdiction, digitalGoodsClass?: DigitalGoodsClass) => number;
  addTaxRemittanceLine: (line: TaxRemittanceLineItem) => void;
  generateTaxRemittanceReport: (merchantId: string, periodStart: Date, periodEnd: Date, jurisdictions?: string[]) => TaxRemittanceReport;
  getTaxRemittanceReports: () => TaxRemittanceReport[];
  getTaxRemittanceReport: (reportId: string) => TaxRemittanceReport | undefined;
  setDigitalGoodsClass: (planId: string, goodsClass: DigitalGoodsClass) => void;
  getDigitalGoodsClass: (planId: string) => DigitalGoodsClass;
  calculateMidCycleTax: (jurisdictionKey: string, subtotal: number, periodStart: Date, periodEnd: Date, rateChanges: Array<{ oldRateBps: number; newRateBps: number; effectiveFrom: Date }>) => MidCycleTaxChange[];
}

// ── Tax types ────────────────────────────────────────────────────────────

export interface TaxSlice {
  taxConfig: TaxConfig;
  taxCalculations: TaxAmount[];
  taxReports: TaxReport[];
  taxRemittances: RemittanceScheduleEntry[];
  addTaxRate: (rate: TaxRate) => void;
  addTaxExemption: (exemption: TaxConfig['exemptions'][number]) => void;
  calculateTaxAmount: (input: TaxCalculationInput) => TaxAmount;
  createTaxReport: (region: string, periodStart: Date, periodEnd: Date) => TaxReport;
  setReverseChargeRegions: (regions: string[]) => void;
}

// ── Accounting types ─────────────────────────────────────────────────────

export interface AccountingSlice {
  accountingRules: Record<string, RevenueRecognitionRule>;
  revenueSchedules: Record<string, RevenueSchedule>;
  deferredRevenue: Record<string, number>;
  recognisedRevenue: Record<string, number>;
  setRecognitionRule: (rule: RevenueRecognitionRule) => void;
  removeRecognitionRule: (subscriptionId: string) => void;
  generateRevenueSchedule: (subscriptionId: string, totalAmount: number, chargeDate: number, billingCycle: BillingCycle, merchantId?: string) => RevenueSchedule;
  recognizeRevenue: (subscriptionId: string, asOf?: number) => Recognition;
  getDeferredRevenue: (merchantId?: string) => number;
  getRevenueSchedule: (subscriptionId: string) => RevenueSchedule | undefined;
  getRevenueAnalyticsByPeriod: (periodMs: number, from: number, to: number) => PeriodRevenue[];
  resetAccounting: () => void;
}

// ── Usage types ──────────────────────────────────────────────────────────

export interface UsageSlice {
  usageRecords: Record<string, UsageRecord[]>;
  usageQuotas: Record<string, Quota[]>;
  usageLoading: boolean;
  usageError: string | null;
  fetchUsage: (subscriptionId: string, planId: string) => Promise<void>;
  recordUsage: (subscriptionId: string, metric: QuotaMetric, amount: number) => Promise<void>;
  getQuotaStatus: (subscriptionId: string, metric: QuotaMetric) => QuotaStatus;
}

// ── Cancellation types ───────────────────────────────────────────────────

export interface CancellationSlice {
  cancellationStep: string;
  cancellationSubscriptionId: string | null;
  cancellationReason: string | null;
  retentionOffers: any[];
  acceptedOfferId: string | null;
  cancellationRecord: any | null;
  cancellationLoading: boolean;
  cancellationError: string | null;
  initCancellationFlow: (subscriptionId: string) => void;
  selectCancellationReason: (reason: string) => Promise<void>;
  acceptRetentionOffer: (offerId: string) => Promise<void>;
  declineRetentionOffers: () => void;
  confirmCancellation: () => Promise<void>;
  resetCancellation: () => void;
}

// ── Pure helpers ─────────────────────────────────────────────────────────

const generateUniqueId = (): string => {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rand}`;
};

const toValidDate = (value: unknown, fallback = new Date()): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
};

const normalizeSubscription = (raw: Partial<Subscription>): Subscription => {
  const now = new Date();
  return {
    id: raw.id ?? generateUniqueId(),
    name: raw.name ?? 'Untitled',
    description: raw.description,
    category: raw.category ?? SubscriptionCategory.OTHER,
    price: Number.isFinite(raw.price) ? (raw.price as number) : 0,
    currency: raw.currency ?? 'USD',
    billingCycle: raw.billingCycle ?? BillingCycle.MONTHLY,
    nextBillingDate: toValidDate(raw.nextBillingDate, now),
    isActive: raw.isActive ?? true,
    notificationsEnabled: raw.notificationsEnabled ?? true,
    isCryptoEnabled: raw.isCryptoEnabled ?? false,
    cryptoStreamId: raw.cryptoStreamId,
    cryptoToken: raw.cryptoToken,
    cryptoAmount: raw.cryptoAmount,
    createdAt: toValidDate(raw.createdAt, now),
    updatedAt: toValidDate(raw.updatedAt, now),
  };
};

const normalizeInvoice = (raw: Partial<Invoice>): Invoice => {
  const createdAt = toValidDate(raw.createdAt);
  return {
    id: raw.id ?? `inv-${Date.now()}`,
    invoiceNumber: raw.invoiceNumber ?? 'INV-000001',
    subscriptionId: raw.subscriptionId ?? 'unknown',
    subscriptionName: raw.subscriptionName ?? 'Subscription',
    merchantName: raw.merchantName ?? 'Merchant',
    lineItems: Array.isArray(raw.lineItems) ? raw.lineItems : [],
    tax: Number.isFinite(raw.tax) ? (raw.tax as number) : 0,
    total: Number.isFinite(raw.total) ? (raw.total as number) : 0,
    subtotal: Number.isFinite(raw.subtotal) ? (raw.subtotal as number) : 0,
    dueDate: toValidDate(raw.dueDate),
    status: raw.status ?? InvoiceStatus.DRAFT,
    currency: raw.currency ?? DEFAULT_INVOICE_CONFIG.defaultCurrency,
    region: raw.region ?? DEFAULT_INVOICE_CONFIG.defaultRegion,
    exchangeRate: Number.isFinite(raw.exchangeRate) ? (raw.exchangeRate as number) : 1_000_000,
    period: {
      start: toValidDate(raw.period?.start),
      end: toValidDate(raw.period?.end),
    },
    createdAt,
    updatedAt: toValidDate(raw.updatedAt, createdAt),
    recipientEmail: raw.recipientEmail,
    notes: raw.notes,
  };
};

const applyInvoiceStatus = (invoices: Invoice[], id: string, status: InvoiceStatus): Invoice[] =>
  invoices.map((inv) => (inv.id === id ? { ...inv, status, updatedAt: new Date() } : inv));

const jurisdictionFallbackKeys = (jurisdiction: TaxJurisdiction): string[] => {
  const key = buildJurisdictionKey(jurisdiction);
  const parts = key.split('-');
  const keys: string[] = [];
  while (parts.length > 0) {
    keys.push(parts.join('-'));
    parts.pop();
  }
  keys.push('GLOBAL');
  return keys;
};

const BPS_SCALE = 10_000;

// ── Accounting helpers ───────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const billingCycleToMs = (cycle: BillingCycle): number => {
  switch (cycle) {
    case BillingCycle.WEEKLY: return 7 * MS_PER_DAY;
    case BillingCycle.MONTHLY: return Math.round(30.44 * MS_PER_DAY);
    case BillingCycle.YEARLY: return 365 * MS_PER_DAY;
    default: return 30 * MS_PER_DAY;
  }
};

const buildStraightLineSchedule = (
  subscriptionId: string,
  totalAmount: number,
  chargeDate: number,
  periodMs: number,
  numPeriods: number,
): RevenueSchedule => {
  const slice = Math.floor((totalAmount / numPeriods) * 100) / 100;
  const remainder = Math.round((totalAmount - slice * numPeriods) * 100) / 100;
  const entries: RevenueScheduleEntry[] = Array.from({ length: numPeriods }, (_, i) => ({
    periodStart: chargeDate + i * periodMs,
    periodEnd: chargeDate + (i + 1) * periodMs,
    recognisedAmount: i === numPeriods - 1 ? Math.round((slice + remainder) * 100) / 100 : slice,
    isRecognised: false,
  }));
  return { subscriptionId, totalAmount, chargeDate, entries };
};

const buildUsageBasedSchedule = (
  subscriptionId: string,
  totalAmount: number,
  chargeDate: number,
  intervalMs: number,
): RevenueSchedule => ({
  subscriptionId,
  totalAmount,
  chargeDate,
  entries: [{
    periodStart: chargeDate,
    periodEnd: chargeDate + intervalMs,
    recognisedAmount: totalAmount,
    isRecognised: false,
  }],
});

const splitRecognisedDeferred = (schedule: RevenueSchedule, now: number): { recognised: number; deferred: number } => {
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
};

const DEFAULT_MERCHANT = 'default';
const emptyStats = {
  totalActive: 0,
  totalMonthlySpend: 0,
  totalYearlySpend: 0,
  categoryBreakdown: {} as Record<string, number>,
};

const CANCELLATION_REASONS = [
  'Too Expensive',
  'Switching to Competitor',
  'Technical Issues',
  'Missing Features',
  'Not Using It',
  'Other',
] as const;

// ── Store type for cross-slice access ────────────────────────────────────

type BillingStore = SubscriptionSlice & InvoiceSlice & TaxSlice & AccountingSlice & UsageSlice & CancellationSlice;
type BillingCreator = StateCreator<BillingStore & any, [], [], BillingStore>;

// ═══════════════════════════════════════════════════════════════════════════
// Slice Factory
// ═══════════════════════════════════════════════════════════════════════════

export const createBillingSlice: BillingCreator = (set, get) => ({
  // ── Subscription state ─────────────────────────────────────────────
  subscriptions: [],
  stats: emptyStats,
  isLoading: false,
  error: null,
  prorationPreview: null,
  creditMemos: {},

  addSubscription: async (data: SubscriptionFormData) => {
    set({ isLoading: true, error: null });
    try {
      const newSub = normalizeSubscription({
        ...data,
        isActive: true,
        notificationsEnabled: data.notificationsEnabled !== false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Partial<Subscription>);
      set((s) => ({ subscriptions: [...s.subscriptions, newSub], isLoading: false }));
      get().calculateStats();
      await syncRenewalReminders(get().subscriptions);
      // Cross-slice: if calendarSlice is available
      if ((get() as any).syncSubscriptionToCalendars) {
        try {
          await (get() as any).syncSubscriptionToCalendars(newSub);
        } catch { /* ignore cross-slice errors */ }
      }
      if ((get() as any).addPoints) {
        (get() as any).addPoints(10);
      }
    } catch (error) {
      set({ error: errorHandler.handleError(error as Error, { action: 'addSubscription' }), isLoading: false });
    }
  },

  updateSubscription: async (id: string, data: Partial<Subscription>) => {
    set({ isLoading: true, error: null });
    try {
      set((s) => ({
        subscriptions: s.subscriptions.map((sub) =>
          sub.id === id ? { ...sub, ...data, updatedAt: new Date() } : sub
        ),
        isLoading: false,
      }));
      get().calculateStats();
      await syncRenewalReminders(get().subscriptions);
      const updated = get().subscriptions.find((sub) => sub.id === id);
      if (updated && (get() as any).syncSubscriptionToCalendars) {
        try { await (get() as any).syncSubscriptionToCalendars(updated); } catch { /* ignore */ }
      }
    } catch (error) {
      set({ error: errorHandler.handleError(error as Error, { action: 'updateSubscription' }), isLoading: false });
    }
  },

  deleteSubscription: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      set((s) => ({ subscriptions: s.subscriptions.filter((sub) => sub.id !== id), isLoading: false }));
      get().calculateStats();
      await syncRenewalReminders(get().subscriptions);
      if ((get() as any).removeSubscriptionFromCalendars) {
        try { await (get() as any).removeSubscriptionFromCalendars(id); } catch { /* ignore */ }
      }
    } catch (error) {
      set({ error: errorHandler.handleError(error as Error, { action: 'deleteSubscription' }), isLoading: false });
    }
  },

  toggleSubscriptionStatus: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      set((s) => ({
        subscriptions: s.subscriptions.map((sub) =>
          sub.id === id ? { ...sub, isActive: !sub.isActive, updatedAt: new Date() } : sub
        ),
        isLoading: false,
      }));
      get().calculateStats();
      await syncRenewalReminders(get().subscriptions);
      const updated = get().subscriptions.find((sub) => sub.id === id);
      if (updated && (get() as any).syncSubscriptionToCalendars) {
        try { await (get() as any).syncSubscriptionToCalendars(updated); } catch { /* ignore */ }
      }
    } catch (error) {
      set({ error: errorHandler.handleError(error as Error, { action: 'toggleSubscriptionStatus' }), isLoading: false });
    }
  },

  previewPlanChange: (id: string, newPrice: number, effectiveDate: 'immediate' | 'end_of_period') => {
    const sub = get().subscriptions.find((s) => s.id === id);
    if (!sub) throw new Error('Subscription not found');
    const preview = previewProration(sub, newPrice, effectiveDate);
    set({ prorationPreview: preview });
    return preview;
  },

  executePlanChange: async (id: string, newPlanData: Partial<Subscription>, effectiveDate: 'immediate' | 'end_of_period') => {
    set({ isLoading: true, error: null });
    try {
      const sub = get().subscriptions.find((s) => s.id === id);
      if (!sub) throw new Error('Subscription not found');
      const preview = previewProration(sub, newPlanData.price ?? sub.price, effectiveDate);
      let updatedCreditMemos = { ...get().creditMemos };
      if (preview.isCredit && preview.amount > 0) {
        const memo = generateCreditMemo(id, preview.amount, preview.description);
        updatedCreditMemos[id] = memo;
      }
      const updates: Partial<Subscription> = {
        ...newPlanData,
        updatedAt: new Date(),
      };
      if (effectiveDate === 'immediate') {
        updates.nextBillingDate = advanceBillingDate(new Date(), newPlanData.billingCycle ?? sub.billingCycle);
      }
      set((s) => ({
        subscriptions: s.subscriptions.map((sub) => (sub.id === id ? { ...sub, ...updates } : sub)),
        creditMemos: updatedCreditMemos,
        prorationPreview: null,
        isLoading: false,
      }));
      get().calculateStats();
      await syncRenewalReminders(get().subscriptions);
    } catch (error) {
      set({ error: errorHandler.handleError(error as Error, { action: 'executePlanChange', subscriptionId: id }), isLoading: false });
    }
  },

  applyCreditToSubscription: async (id: string) => {
    const sub = get().subscriptions.find((s) => s.id === id);
    const memo = get().creditMemos[id];
    if (!sub || !memo || memo.applied) return;
    const { finalCharge, updatedMemo } = applyCreditMemo(sub.price, memo);
    set((s) => ({ creditMemos: { ...s.creditMemos, [id]: updatedMemo } }));
  },

  recordBillingOutcome: async (id: string, outcome: 'success' | 'failed') => {
    const sub = get().subscriptions.find((s) => s.id === id);
    if (!sub) return;

    if (outcome === 'failed') {
      const dunningEntries = JSON.parse((await AsyncStorage.getItem('subtrackr-dunning-entries')) || '{}');
      const entry = dunningEntries[id];
      const attempt = (entry?.failedAttempts ?? 0) + 1;
      dunningEntries[id] = {
        failedAttempts: attempt,
        lastFailureAt: new Date().toISOString(),
        currentStage: attempt <= 3 ? 'retry' : attempt <= 5 ? 'warn' : attempt <= 7 ? 'suspend' : 'cancel',
      };
      await AsyncStorage.setItem('subtrackr-dunning-entries', JSON.stringify(dunningEntries));
      if (sub.notificationsEnabled !== false) {
        await presentChargeFailedNotification(sub);
        if (attempt <= 3) await presentDunningRetryNotification(sub, attempt, 3);
        else if (attempt <= 5) await presentDunningWarningNotification(sub, attempt);
        else if (attempt <= 7) await presentDunningSuspendedNotification(sub);
        else await presentDunningCancelledNotification(sub);
      }
      set({ isLoading: false });
      return;
    }

    if (outcome === 'success') {
      const hasDunningEntry = await AsyncStorage.getItem('subtrackr-dunning-entries');
      if (hasDunningEntry) {
        await AsyncStorage.removeItem('subtrackr-dunning-entries');
        if (sub.notificationsEnabled !== false) await presentDunningRecoveryNotification(sub);
      }
      await presentChargeSuccessNotification(sub);
      const next = advanceBillingDate(new Date(sub.nextBillingDate), sub.billingCycle);
      const simulatedGas = 0.01 + Math.random() * 0.005;
      set((s) => ({
        subscriptions: s.subscriptions.map((sub) =>
          sub.id === id ? {
            ...sub, nextBillingDate: next, updatedAt: new Date(),
            totalGasSpent: (sub.totalGasSpent || 0) + simulatedGas,
            chargeCount: (sub.chargeCount || 0) + 1, lastGasCost: simulatedGas, gasBudget: sub.gasBudget || 0.05,
          } : sub
        ),
      }));
      get().calculateStats();
      await syncRenewalReminders(get().subscriptions);
      const updated = get().subscriptions.find((entry) => entry.id === id);
      if (updated && (get() as any).syncSubscriptionToCalendars) {
        try { await (get() as any).syncSubscriptionToCalendars(updated); } catch { /* ignore */ }
      }
      if ((get() as any).generateInvoiceFromSubscription) {
        try {
          await (get() as any).generateInvoiceFromSubscription({
            subscription: sub,
            period: { start: sub.createdAt, end: sub.nextBillingDate },
            region: 'GLOBAL', currency: sub.currency,
            recipientEmail: `${sub.name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@billing.local`,
          }, 0);
        } catch { /* ignore */ }
      }
    }
  },

  fetchSubscriptions: async () => {
    set({ isLoading: true, error: null });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      set({ isLoading: false });
      get().calculateStats();
      await syncRenewalReminders(get().subscriptions);
      if ((get() as any).syncSubscriptions) {
        try { await (get() as any).syncSubscriptions(get().subscriptions); } catch { /* ignore */ }
      }
    } catch (error) {
      set({ error: errorHandler.handleError(error as Error, { action: 'fetchSubscriptions' }), isLoading: false });
    }
  },

  calculateStats: () => {
    const { subscriptions } = get();
    if (!subscriptions || !Array.isArray(subscriptions)) {
      set({ stats: emptyStats });
      return;
    }
    const activeSubs = subscriptions.filter((sub) => sub.isActive);
    const totalMonthlySpend = activeSubs.reduce((total, sub) => {
      if (sub.billingCycle === 'monthly') return total + sub.price;
      if (sub.billingCycle === 'yearly') return total + sub.price / 12;
      if (sub.billingCycle === 'weekly') return total + sub.price * BILLING_CONVERSIONS.WEEKS_PER_MONTH;
      return total + sub.price;
    }, 0);
    const totalYearlySpend = activeSubs.reduce((total, sub) => {
      if (sub.billingCycle === 'yearly') return total + sub.price;
      if (sub.billingCycle === 'monthly') return total + sub.price * BILLING_CONVERSIONS.MONTHS_PER_YEAR;
      if (sub.billingCycle === 'weekly') return total + sub.price * BILLING_CONVERSIONS.WEEKS_PER_YEAR;
      return total + sub.price * BILLING_CONVERSIONS.MONTHS_PER_YEAR;
    }, 0);
    const categoryBreakdown = activeSubs.reduce((acc, sub) => {
      acc[sub.category] = (acc[sub.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const totalGasSpent = activeSubs.reduce((total, sub) => total + (sub.totalGasSpent || 0), 0);
    set({ stats: { totalActive: activeSubs.length, totalMonthlySpend, totalYearlySpend, categoryBreakdown, totalGasSpent } });
  },

  // ── Invoice state ──────────────────────────────────────────────────
  invoices: [],
  invoiceConfig: DEFAULT_INVOICE_CONFIG,
  nextSequence: 1,
  invoiceLoading: false,
  invoiceError: null,

  generateInvoiceFromSubscription: async (data, taxRateBps, exchangeRate) => {
    set({ invoiceLoading: true, invoiceError: null });
    try {
      const state = get();
      const region = data.region ?? state.invoiceConfig?.defaultRegion ?? 'GLOBAL';
      const currency = data.currency ?? state.invoiceConfig?.defaultCurrency ?? 'USD';
      const invoice = buildInvoice(
        data.subscription,
        state.nextSequence ?? 1,
        data.period,
        { ...state.invoiceConfig ?? DEFAULT_INVOICE_CONFIG, defaultCurrency: currency, defaultRegion: region },
        taxRateBps ?? state.invoiceConfig?.defaultTaxRateBps ?? 0,
        exchangeRate ?? state.invoiceConfig?.exchangeRateScale ?? 1_000_000,
        region,
        data.recipientEmail,
        data.notes
      );
      if (data.taxJurisdiction) invoice.taxJurisdiction = data.taxJurisdiction;
      set((s) => ({
        invoices: [...s.invoices, invoice],
        nextSequence: (s.nextSequence ?? 1) + 1,
        invoiceLoading: false,
      }));
      return invoice;
    } catch (error) {
      set({ invoiceError: errorHandler.handleError(error as Error, { action: 'generateInvoiceFromSubscription' }), invoiceLoading: false });
      throw error;
    }
  },

  generateTaxInvoice: async (input) => {
    set({ invoiceLoading: true, invoiceError: null });
    try {
      const state = get();
      const jurisdictionKey = buildJurisdictionKey(input.jurisdiction);
      let effectiveRateBps = input.effectiveTaxRateBps;
      if (input.isExempt) effectiveRateBps = 0;
      const invoice = buildInvoice(
        input.subscription, state.nextSequence ?? 1,
        { start: new Date(), end: new Date(input.subscription.nextBillingDate) },
        { ...state.invoiceConfig ?? DEFAULT_INVOICE_CONFIG },
        effectiveRateBps, state.invoiceConfig?.exchangeRateScale ?? 1_000_000,
        jurisdictionKey, undefined, undefined
      );
      invoice.taxJurisdiction = input.jurisdiction;
      invoice.isTaxExempt = input.isExempt;
      invoice.reverseCharge = input.reverseCharge;
      if (input.reverseCharge) invoice.region = `${jurisdictionKey}-RC`;
      invoice.lineItems[0].taxRateBps = effectiveRateBps;
      set((s) => ({ invoices: [...s.invoices, invoice], nextSequence: (s.nextSequence ?? 1) + 1, invoiceLoading: false }));
      return invoice;
    } catch (error) {
      set({ invoiceError: errorHandler.handleError(error as Error, { action: 'generateTaxInvoice' }), invoiceLoading: false });
      throw error;
    }
  },

  updateInvoiceStatus: async (id, status) => {
    set({ invoiceLoading: true, invoiceError: null });
    try {
      set((s) => ({ invoices: applyInvoiceStatus(s.invoices, id, status), invoiceLoading: false }));
    } catch (error) {
      set({ invoiceError: errorHandler.handleError(error as Error, { action: 'updateInvoiceStatus' }), invoiceLoading: false });
    }
  },

  voidInvoice: async (id) => { await get().updateInvoiceStatus(id, InvoiceStatus.VOID); },
  sendInvoice: async (id, recipientEmail) => {
    const invoice = get().invoices.find((entry) => entry.id === id);
    if (!invoice) return;
    if (recipientEmail && recipientEmail !== invoice.recipientEmail) {
      set((s) => ({
        invoices: s.invoices.map((entry) =>
          entry.id === id ? { ...entry, recipientEmail, status: InvoiceStatus.SENT, updatedAt: new Date() } : entry
        ),
      }));
    } else {
      await get().updateInvoiceStatus(id, InvoiceStatus.SENT);
    }
    await presentLocalNotification({
      title: `Invoice ready: ${invoice.invoiceNumber}`,
      body: recipientEmail ? `Draft email prepared for ${recipientEmail}` : 'Invoice marked as sent.',
      data: { invoiceId: id, recipientEmail },
    });
  },
  markInvoicePaid: async (id) => { await get().updateInvoiceStatus(id, InvoiceStatus.PAID); },
  setTaxRate: (region, taxRateBps) => set((s) => ({ invoiceConfig: { ...s.invoiceConfig, defaultRegion: region, defaultTaxRateBps: taxRateBps } })),
  setTaxJurisdiction: (entry) => set((s) => ({ taxRates: [...s.taxRates.filter((r) => r.jurisdictionKey !== entry.jurisdictionKey), entry] })),
  removeTaxJurisdiction: (jurisdictionKey) => set((s) => ({ taxRates: s.taxRates.filter((r) => r.jurisdictionKey !== jurisdictionKey) })),
  setExchangeRate: (currency, exchangeRate) => set((s) => ({ invoiceConfig: { ...s.invoiceConfig, defaultCurrency: currency, exchangeRateScale: exchangeRate } })),
  calculateTotals: (id) => {
    const invoice = get().invoices.find((entry) => entry.id === id);
    if (!invoice) return null;
    return calculateInvoiceTotals(invoice.lineItems, invoice.lineItems[0]?.taxRateBps ?? 0);
  },
  setCustomerTaxStatus: (subscriberId, status) => set((s) => ({ customerTaxStatuses: { ...s.customerTaxStatuses, [subscriberId]: status } })),
  removeCustomerTaxStatus: (subscriberId) => set((s) => {
    const updated = { ...s.customerTaxStatuses };
    delete updated[subscriberId];
    return { customerTaxStatuses: updated };
  }),
  isCustomerTaxExempt: (subscriberId, jurisdictionKey) => checkIsTaxExempt(get().customerTaxStatuses[subscriberId] ?? null),
  validateTaxCertificate: (subscriberId, certificateId) => {
    const status = get().customerTaxStatuses[subscriberId];
    if (!status || !status.isExempt || status.certificateId !== certificateId) return false;
    if (status.certificateExpiry && status.certificateExpiry < new Date()) return false;
    return true;
  },
  lookupTaxRate: (jurisdiction, digitalGoodsClass) => {
    const keys = jurisdictionFallbackKeys(jurisdiction);
    for (const key of keys) {
      const entry = get().taxRates.find((r) => r.jurisdictionKey === key);
      if (entry) return entry;
    }
    return null;
  },
  resolveEffectiveTaxRateBps: (jurisdiction, digitalGoodsClass) => get().lookupTaxRate(jurisdiction, digitalGoodsClass)?.rateBps ?? get().invoiceConfig.defaultTaxRateBps,
  addTaxRemittanceLine: (line) => set((s) => ({ taxRemittanceLines: [...s.taxRemittanceLines, line] })),
  generateTaxRemittanceReport: (merchantId, periodStart, periodEnd, jurisdictions) => {
    const lines = get().taxRemittanceLines;
    const reportId = `rpt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const aggregated = new Map<string, TaxRemittanceLineItem>();
    for (const line of lines) {
      if (jurisdictions && jurisdictions.length > 0 && !jurisdictions.includes(line.jurisdictionKey)) continue;
      const groupKey = `${line.jurisdictionKey}:${line.taxType}:${line.currency}`;
      const existing = aggregated.get(groupKey);
      if (existing) {
        existing.taxableAmount += line.taxableAmount;
        existing.taxCollected += line.taxCollected;
        existing.transactionCount += line.transactionCount;
      } else {
        aggregated.set(groupKey, { ...line });
      }
    }
    const lineItems = Array.from(aggregated.values());
    const totalTaxCollected = lineItems.reduce((sum, l) => sum + l.taxCollected, 0);
    const totalTaxableAmount = lineItems.reduce((sum, l) => sum + l.taxableAmount, 0);
    const report: TaxRemittanceReport = { reportId, generatedAt: new Date(), periodStart, periodEnd, merchant: merchantId, lineItems, totalTaxCollected, totalTaxableAmount };
    set((s) => ({ taxRemittanceReports: [...s.taxRemittanceReports, report] }));
    return report;
  },
  getTaxRemittanceReports: () => get().taxRemittanceReports,
  getTaxRemittanceReport: (reportId) => get().taxRemittanceReports.find((r) => r.reportId === reportId),
  setDigitalGoodsClass: (planId, goodsClass) => set((s) => ({ digitalGoodsClasses: { ...s.digitalGoodsClasses, [planId]: goodsClass } })),
  getDigitalGoodsClass: (planId) => get().digitalGoodsClasses[planId] ?? DigitalGoodsClass.ELECTRONIC_SERVICE,

  calculateMidCycleTax: (jurisdictionKey, subtotal, periodStart, periodEnd, rateChanges) => {
    const periodDuration = periodEnd.getTime() - periodStart.getTime();
    if (periodDuration <= 0) return [];
    const relevant = rateChanges.filter((c) => c.effectiveFrom > periodStart && c.effectiveFrom < periodEnd).sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
    if (relevant.length === 0) return [];
    const results: MidCycleTaxChange[] = [];
    let currentStart = periodStart;
    let currentRateBps: number | null = null;
    for (const change of relevant) {
      const segmentDuration = change.effectiveFrom.getTime() - currentStart.getTime();
      const segmentRatio = segmentDuration / periodDuration;
      const segmentSubtotal = Math.round(subtotal * segmentRatio);
      if (currentRateBps === null) currentRateBps = change.oldRateBps;
      const segmentTax = Math.round((segmentSubtotal * currentRateBps) / BPS_SCALE);
      results.push({ jurisdictionKey, oldRateBps: currentRateBps, newRateBps: change.newRateBps, effectiveFrom: change.effectiveFrom, periodStart: currentStart, periodEnd: change.effectiveFrom, proratedTaxOld: segmentTax, proratedTaxNew: 0, totalTax: segmentTax });
      currentStart = change.effectiveFrom;
      currentRateBps = change.newRateBps;
    }
    if (currentStart < periodEnd && currentRateBps !== null) {
      const remainingDuration = periodEnd.getTime() - currentStart.getTime();
      const remainingRatio = remainingDuration / periodDuration;
      const remainingSubtotal = Math.round(subtotal * remainingRatio);
      const remainingTax = Math.round((remainingSubtotal * currentRateBps) / BPS_SCALE);
      results.push({ jurisdictionKey, oldRateBps: currentRateBps, newRateBps: currentRateBps, effectiveFrom: currentStart, periodStart: currentStart, periodEnd, proratedTaxOld: 0, proratedTaxNew: remainingTax, totalTax: remainingTax });
    }
    return results;
  },

  // ── Tax state ──────────────────────────────────────────────────────
  taxConfig: {
    merchantId: 'default-merchant',
    ratesByRegion: [
      { region: 'US-CA', taxType: 'sales_tax', rateBps: 725, effectiveFrom: new Date('2024-01-01T00:00:00.000Z') },
      { region: 'EU-DE', taxType: 'vat', rateBps: 1900, effectiveFrom: new Date('2024-01-01T00:00:00.000Z') },
    ],
    remittanceSchedule: 'monthly',
    exemptions: [],
    reverseChargeRegions: [],
  },
  taxCalculations: [],
  taxReports: [],
  taxRemittances: [],
  addTaxRate: (rate) => set((s) => ({ taxConfig: { ...s.taxConfig, ratesByRegion: [...s.taxConfig.ratesByRegion, rate] } })),
  addTaxExemption: (exemption) => set((s) => ({ taxConfig: { ...s.taxConfig, exemptions: [...s.taxConfig.exemptions, exemption] } })),
  calculateTaxAmount: (input) => {
    const result = calculateTaxAmount(get().taxConfig, input);
    set((s) => ({ taxCalculations: [...s.taxCalculations, result] }));
    return result;
  },
  createTaxReport: (region, periodStart, periodEnd) => {
    const report = buildTaxReport(get().taxConfig, get().taxCalculations, periodStart, periodEnd, region);
    const remittance = scheduleTaxRemittance(report, get().taxConfig.remittanceSchedule);
    set((s) => ({ taxReports: [...s.taxReports, report], taxRemittances: [...s.taxRemittances, remittance] }));
    return report;
  },
  setReverseChargeRegions: (regions) => set((s) => ({ taxConfig: { ...s.taxConfig, reverseChargeRegions: regions } })),

  // ── Accounting state ──────────────────────────────────────────────
  accountingRules: {},
  revenueSchedules: {},
  deferredRevenue: {},
  recognisedRevenue: {},

  setRecognitionRule: (rule) => set((s) => ({ accountingRules: { ...s.accountingRules, [rule.subscriptionId]: rule } })),
  removeRecognitionRule: (subscriptionId) => set((s) => {
    const rules = { ...s.accountingRules };
    delete rules[subscriptionId];
    return { accountingRules: rules };
  }),

  generateRevenueSchedule: (subscriptionId, totalAmount, chargeDate, billingCycle, merchantId = DEFAULT_MERCHANT) => {
    const rule = get().accountingRules[subscriptionId];
    const intervalMs = billingCycleToMs(billingCycle);
    let schedule: RevenueSchedule;
    if (rule) {
      const numPeriods = Math.max(1, Math.ceil(intervalMs / rule.recognitionPeriodMs));
      schedule = rule.method === 'straight-line'
        ? buildStraightLineSchedule(subscriptionId, totalAmount, chargeDate, rule.recognitionPeriodMs, numPeriods)
        : buildUsageBasedSchedule(subscriptionId, totalAmount, chargeDate, intervalMs);
    } else {
      schedule = buildStraightLineSchedule(subscriptionId, totalAmount, chargeDate, intervalMs, 1);
    }
    set((s) => ({
      revenueSchedules: { ...s.revenueSchedules, [subscriptionId]: schedule },
      deferredRevenue: { ...s.deferredRevenue, [merchantId]: (s.deferredRevenue[merchantId] ?? 0) + totalAmount },
    }));
    return schedule;
  },

  recognizeRevenue: (subscriptionId, asOf = Date.now()) => {
    const schedule = get().revenueSchedules[subscriptionId];
    if (!schedule) return { subscriptionId, recognisedRevenue: 0, deferredRevenue: 0, asOf };
    const { recognised, deferred } = splitRecognisedDeferred(schedule, asOf);
    return { subscriptionId, recognisedRevenue: recognised, deferredRevenue: deferred, asOf };
  },

  getDeferredRevenue: (merchantId = DEFAULT_MERCHANT) => get().deferredRevenue[merchantId] ?? 0,
  getRevenueSchedule: (subscriptionId) => get().revenueSchedules[subscriptionId],

  getRevenueAnalyticsByPeriod: (periodMs, from, to) => {
    if (periodMs <= 0) throw new Error('periodMs must be > 0');
    if (to < from || to === from) return [];
    const numBuckets = Math.ceil((to - from) / periodMs);
    const buckets: PeriodRevenue[] = Array.from({ length: numBuckets }, (_, i) => ({
      periodStart: from + i * periodMs, periodEnd: from + (i + 1) * periodMs, recognisedAmount: 0, subscriptionCount: 0,
    }));
    for (const schedule of Object.values(get().revenueSchedules)) {
      let contributed = false;
      for (const entry of schedule.entries) {
        if (entry.periodStart < from || entry.periodStart >= to) continue;
        const bucketIdx = Math.floor((entry.periodStart - from) / periodMs);
        if (bucketIdx >= 0 && bucketIdx < numBuckets) {
          buckets[bucketIdx].recognisedAmount += entry.recognisedAmount;
          if (!contributed) { buckets[bucketIdx].subscriptionCount += 1; contributed = true; }
        }
      }
    }
    return buckets;
  },

  resetAccounting: () => set({ accountingRules: {}, revenueSchedules: {}, deferredRevenue: {}, recognisedRevenue: {} }),

  // ── Usage state ──────────────────────────────────────────────────
  usageRecords: {},
  usageQuotas: {},
  usageLoading: false,
  usageError: null,

  fetchUsage: async (_subscriptionId, _planId) => {
    set({ usageLoading: true, usageError: null });
    try {
      set({ usageLoading: false });
    } catch (error) {
      set({ usageError: 'Failed to fetch usage', usageLoading: false });
    }
  },

  recordUsage: async (subscriptionId, metric, amount) => {
    set({ usageLoading: true, usageError: null });
    try {
      set((s) => {
        const currentRecords = s.usageRecords[subscriptionId] || [];
        const recordIdx = currentRecords.findIndex((r) => r.metric === metric);
        let updatedRecords;
        if (recordIdx > -1) {
          updatedRecords = [...currentRecords];
          updatedRecords[recordIdx] = { ...updatedRecords[recordIdx], currentUsage: updatedRecords[recordIdx].currentUsage + amount };
        } else {
          updatedRecords = [...currentRecords, { subscriptionId, metric, currentUsage: amount, periodStart: new Date(), rolloverBalance: 0 } as UsageRecord];
        }
        return { usageRecords: { ...s.usageRecords, [subscriptionId]: updatedRecords }, usageLoading: false };
      });
    } catch (error) {
      set({ usageError: 'Failed to record usage', usageLoading: false });
    }
  },

  getQuotaStatus: (subscriptionId, metric) => {
    const records = get().usageRecords[subscriptionId] || [];
    const record = records.find((r) => r.metric === metric);
    if (!record) return QuotaStatus.WITHIN_LIMIT;
    const limit = 1000;
    const usage = record.currentUsage;
    if (usage >= limit) return QuotaStatus.HARD_LIMIT_REACHED;
    if (usage >= limit * 0.8) return QuotaStatus.SOFT_LIMIT_REACHED;
    return QuotaStatus.WITHIN_LIMIT;
  },

  // ── Cancellation state ─────────────────────────────────────────
  cancellationStep: 'REASON',
  cancellationSubscriptionId: null,
  cancellationReason: null,
  retentionOffers: [],
  acceptedOfferId: null,
  cancellationRecord: null,
  cancellationLoading: false,
  cancellationError: null,

  initCancellationFlow: (subscriptionId) => {
    set({ cancellationStep: 'REASON', cancellationSubscriptionId: subscriptionId, cancellationReason: null, retentionOffers: [], acceptedOfferId: null, cancellationRecord: null, cancellationLoading: false, cancellationError: null });
  },

  selectCancellationReason: async (reason) => {
    set({ cancellationLoading: true, cancellationError: null, cancellationReason: reason });
    try {
      const { cancellationSubscriptionId: subId, subscriptions, stats } = get();
      if (!subId) throw new Error('No subscription selected');
      const sub = subscriptions.find((s) => s.id === subId);
      if (!sub) throw new Error('Subscription not found');
      const totalMonthlySpend = subscriptions.filter((s) => s.isActive).reduce((acc, s) => acc + (s.billingCycle === 'monthly' ? s.price : s.price / 12), 0);
      const monthsActive = Math.max(1, Math.floor((Date.now() - new Date(sub.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30)));
      const offers = [
        { id: `offer-${Date.now()}-1`, type: 'discount', description: '15% off for 3 months', value: 15 },
        { id: `offer-${Date.now()}-2`, type: 'pause', description: 'Pause for 2 months', value: 0 },
      ];
      set({ retentionOffers: offers, cancellationStep: 'OFFERS', cancellationLoading: false });
    } catch (e) {
      set({ cancellationError: e instanceof Error ? e.message : 'Failed to load offers', cancellationLoading: false });
    }
  },

  acceptRetentionOffer: async (offerId) => {
    set({ cancellationLoading: true, cancellationError: null });
    try {
      set({ acceptedOfferId: offerId, cancellationStep: 'SUCCESS', cancellationLoading: false });
    } catch (e) {
      set({ cancellationError: e instanceof Error ? e.message : 'Failed to accept offer', cancellationLoading: false });
    }
  },

  declineRetentionOffers: () => set({ cancellationStep: 'CONFIRM' }),

  confirmCancellation: async () => {
    set({ cancellationLoading: true, cancellationError: null });
    try {
      const subId = get().cancellationSubscriptionId;
      if (!subId) throw new Error('Missing cancellation data');
      get().updateSubscription(subId, { isActive: false });
      set({ cancellationStep: 'SUCCESS', cancellationLoading: false });
    } catch (e) {
      set({ cancellationError: e instanceof Error ? e.message : 'Failed to process cancellation', cancellationLoading: false });
    }
  },

  resetCancellation: () => set({
    cancellationStep: 'REASON', cancellationSubscriptionId: null, cancellationReason: null,
    retentionOffers: [], acceptedOfferId: null, cancellationRecord: null,
    cancellationLoading: false, cancellationError: null,
  }),
});
