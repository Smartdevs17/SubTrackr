import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_INVOICE_CONFIG,
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
} from '../types/invoice';
import { buildInvoice, calculateInvoiceTotals } from '../utils/invoice';
import { CACHE_CONSTANTS } from '../utils/constants/values';
import { errorHandler, AppError } from '../services/errorHandler';
import { presentLocalNotification } from '../services/notificationService';

const STORAGE_KEY = 'subtrackr-invoices';
const STORE_VERSION = 1;
const WRITE_DEBOUNCE_MS = CACHE_CONSTANTS.WRITE_DEBOUNCE_MS;

type PersistedInvoiceSlice = Pick<
  InvoiceState,
  | 'invoices'
  | 'config'
  | 'nextSequence'
  | 'taxRates'
  | 'customerTaxStatuses'
  | 'taxRemittanceLines'
  | 'taxRemittanceReports'
  | 'digitalGoodsClasses'
>;

const toValidDate = (value: unknown, fallback = new Date()): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
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

const serializeForStorage = (state: PersistedInvoiceSlice): PersistedInvoiceSlice => ({
  invoices: state.invoices.map((invoice) => ({
    ...invoice,
    dueDate: new Date(invoice.dueDate),
    period: {
      start: new Date(invoice.period.start),
      end: new Date(invoice.period.end),
    },
    createdAt: new Date(invoice.createdAt),
    updatedAt: new Date(invoice.updatedAt),
  })),
  config: state.config,
  nextSequence: state.nextSequence,
  taxRates: state.taxRates,
  customerTaxStatuses: state.customerTaxStatuses,
  taxRemittanceLines: state.taxRemittanceLines,
  taxRemittanceReports: state.taxRemittanceReports,
  digitalGoodsClasses: state.digitalGoodsClasses,
});

const migratePersistedState = (persisted: unknown): PersistedInvoiceSlice => {
  if (!persisted || typeof persisted !== 'object') {
    return {
      invoices: [],
      config: DEFAULT_INVOICE_CONFIG,
      nextSequence: 1,
      taxRates: [],
      customerTaxStatuses: {},
      taxRemittanceLines: [],
      taxRemittanceReports: [],
      digitalGoodsClasses: {},
    };
  }

  const maybeState = persisted as Partial<PersistedInvoiceSlice>;
  const invoices = Array.isArray(maybeState.invoices)
    ? maybeState.invoices.map((entry) => normalizeInvoice(entry as Partial<Invoice>))
    : [];

  return {
    invoices,
    config: maybeState.config ?? DEFAULT_INVOICE_CONFIG,
    nextSequence: maybeState.nextSequence ?? Math.max(invoices.length + 1, 1),
    taxRates: maybeState.taxRates ?? [],
    customerTaxStatuses: maybeState.customerTaxStatuses ?? {},
    taxRemittanceLines: maybeState.taxRemittanceLines ?? [],
    taxRemittanceReports: maybeState.taxRemittanceReports ?? [],
    digitalGoodsClasses: maybeState.digitalGoodsClasses ?? {},
  };
};

const pendingWrites = new Map<string, string>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue = Promise.resolve();

const flushPendingWrites = async (): Promise<void> => {
  if (pendingWrites.size === 0) return;

  const writes = Array.from(pendingWrites.entries());
  pendingWrites.clear();

  writeQueue = writeQueue.then(async () => {
    await Promise.all(writes.map(([key, value]) => AsyncStorage.setItem(key, value)));
  });

  try {
    await writeQueue;
  } catch (error) {
    console.warn('Failed to persist invoices:', error);
  }
};

const debouncedAsyncStorage: StateStorage = {
  getItem: async (name) => {
    if (pendingWrites.has(name)) return pendingWrites.get(name) ?? null;
    await writeQueue;
    return AsyncStorage.getItem(name);
  },
  setItem: async (name, value) => {
    pendingWrites.set(name, value);
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      void flushPendingWrites();
    }, WRITE_DEBOUNCE_MS);
  },
  removeItem: async (name) => {
    pendingWrites.delete(name);
    if (writeTimer && pendingWrites.size === 0) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    await writeQueue;
    await AsyncStorage.removeItem(name);
  },
};

const BPS_SCALE = 10_000;

interface InvoiceState {
  invoices: Invoice[];
  config: InvoiceConfig;
  nextSequence: number;
  isLoading: boolean;
  error: AppError | null;

  taxRates: TaxRateEntry[];
  customerTaxStatuses: Record<string, CustomerTaxStatus>;
  taxRemittanceLines: TaxRemittanceLineItem[];
  taxRemittanceReports: TaxRemittanceReport[];
  digitalGoodsClasses: Record<string, DigitalGoodsClass>;

  generateInvoiceFromSubscription: (
    data: InvoiceFormData,
    taxRateBps?: number,
    exchangeRate?: number
  ) => Promise<Invoice>;
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

  lookupTaxRate: (
    jurisdiction: TaxJurisdiction,
    digitalGoodsClass?: DigitalGoodsClass
  ) => TaxRateEntry | null;
  resolveEffectiveTaxRateBps: (
    jurisdiction: TaxJurisdiction,
    digitalGoodsClass?: DigitalGoodsClass
  ) => number;

  addTaxRemittanceLine: (line: TaxRemittanceLineItem) => void;
  generateTaxRemittanceReport: (
    merchantId: string,
    periodStart: Date,
    periodEnd: Date,
    jurisdictions?: string[]
  ) => TaxRemittanceReport;
  getTaxRemittanceReports: () => TaxRemittanceReport[];
  getTaxRemittanceReport: (reportId: string) => TaxRemittanceReport | undefined;

  setDigitalGoodsClass: (planId: string, goodsClass: DigitalGoodsClass) => void;
  getDigitalGoodsClass: (planId: string) => DigitalGoodsClass;

  calculateMidCycleTax: (
    jurisdictionKey: string,
    subtotal: number,
    periodStart: Date,
    periodEnd: Date,
    rateChanges: Array<{
      oldRateBps: number;
      newRateBps: number;
      effectiveFrom: Date;
    }>
  ) => MidCycleTaxChange[];
}

const applyInvoiceStatus = (invoices: Invoice[], id: string, status: InvoiceStatus): Invoice[] =>
  invoices.map((invoice) =>
    invoice.id === id ? { ...invoice, status, updatedAt: new Date() } : invoice
  );

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

export const useInvoiceStore = create<InvoiceState>()(
  persist(
    (set, get) => ({
      invoices: [],
      config: DEFAULT_INVOICE_CONFIG,
      nextSequence: 1,
      isLoading: false,
      error: null,
      taxRates: [],
      customerTaxStatuses: {},
      taxRemittanceLines: [],
      taxRemittanceReports: [],
      digitalGoodsClasses: {},

      generateInvoiceFromSubscription: async (data, taxRateBps, exchangeRate) => {
        set({ isLoading: true, error: null });
        try {
          const state = get();
          const region = data.region ?? state.config.defaultRegion;
          const currency = data.currency ?? state.config.defaultCurrency;
          const invoice = buildInvoice(
            data.subscription,
            state.nextSequence,
            data.period,
            { ...state.config, defaultCurrency: currency, defaultRegion: region },
            taxRateBps ?? state.config.defaultTaxRateBps,
            exchangeRate ?? state.config.exchangeRateScale,
            region,
            data.recipientEmail,
            data.notes
          );

          if (data.taxJurisdiction) {
            invoice.taxJurisdiction = data.taxJurisdiction;
          }

          set((current) => ({
            invoices: [...current.invoices, invoice],
            nextSequence: current.nextSequence + 1,
            isLoading: false,
          }));

          return invoice;
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'generateInvoiceFromSubscription',
            metadata: data,
          });
          set({ error: appError, isLoading: false });
          throw error;
        }
      },

      generateTaxInvoice: async (input) => {
        set({ isLoading: true, error: null });
        try {
          const state = get();
          const jurisdictionKey = buildJurisdictionKey(input.jurisdiction);

          let effectiveRateBps = input.effectiveTaxRateBps;
          if (input.isExempt) {
            effectiveRateBps = 0;
          }

          const invoice = buildInvoice(
            input.subscription,
            state.nextSequence,
            {
              start: new Date(),
              end: new Date(input.subscription.nextBillingDate),
            },
            { ...state.config },
            effectiveRateBps,
            state.config.exchangeRateScale,
            jurisdictionKey,
            undefined,
            undefined
          );

          invoice.taxJurisdiction = input.jurisdiction;
          invoice.isTaxExempt = input.isExempt;
          invoice.reverseCharge = input.reverseCharge;

          if (input.reverseCharge) {
            invoice.region = `${jurisdictionKey}-RC`;
          }

          invoice.lineItems[0].taxRateBps = effectiveRateBps;

          set((current) => ({
            invoices: [...current.invoices, invoice],
            nextSequence: current.nextSequence + 1,
            isLoading: false,
          }));

          return invoice;
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'generateTaxInvoice',
            metadata: input,
          });
          set({ error: appError, isLoading: false });
          throw error;
        }
      },

      updateInvoiceStatus: async (id, status) => {
        set({ isLoading: true, error: null });
        try {
          set((state) => ({
            invoices: applyInvoiceStatus(state.invoices, id, status),
            isLoading: false,
          }));
        } catch (error) {
          set({
            error: errorHandler.handleError(error as Error, {
              action: 'updateInvoiceStatus',
              metadata: { id, status },
            }),
            isLoading: false,
          });
        }
      },

      voidInvoice: async (id) => {
        await get().updateInvoiceStatus(id, InvoiceStatus.VOID);
      },

      sendInvoice: async (id, recipientEmail) => {
        const invoice = get().invoices.find((entry) => entry.id === id);
        if (!invoice) return;
        if (recipientEmail && recipientEmail !== invoice.recipientEmail) {
          set((state) => ({
            invoices: state.invoices.map((entry) =>
              entry.id === id
                ? {
                    ...entry,
                    recipientEmail,
                    status: InvoiceStatus.SENT,
                    updatedAt: new Date(),
                  }
                : entry
            ),
          }));
        } else {
          await get().updateInvoiceStatus(id, InvoiceStatus.SENT);
        }

        await presentLocalNotification({
          title: `Invoice ready: ${invoice.invoiceNumber}`,
          body: recipientEmail
            ? `Draft email prepared for ${recipientEmail}`
            : 'Invoice marked as sent in the local ledger.',
          data: { invoiceId: id, recipientEmail },
        });
      },

      markInvoicePaid: async (id) => {
        await get().updateInvoiceStatus(id, InvoiceStatus.PAID);
      },

      setTaxRate: (region, taxRateBps) => {
        set((state) => ({
          config: {
            ...state.config,
            defaultRegion: region,
            defaultTaxRateBps: taxRateBps,
          },
        }));
      },

      setTaxJurisdiction: (entry) => {
        set((state) => ({
          taxRates: [
            ...state.taxRates.filter((r) => r.jurisdictionKey !== entry.jurisdictionKey),
            entry,
          ],
        }));
      },

      removeTaxJurisdiction: (jurisdictionKey) => {
        set((state) => ({
          taxRates: state.taxRates.filter((r) => r.jurisdictionKey !== jurisdictionKey),
        }));
      },

      setExchangeRate: (currency, exchangeRate) => {
        set((state) => ({
          config: {
            ...state.config,
            defaultCurrency: currency,
            exchangeRateScale: exchangeRate,
          },
        }));
      },

      calculateTotals: (id) => {
        const invoice = get().invoices.find((entry) => entry.id === id);
        if (!invoice) return null;
        return calculateInvoiceTotals(invoice.lineItems, invoice.lineItems[0]?.taxRateBps ?? 0);
      },

      setCustomerTaxStatus: (subscriberId, status) => {
        set((state) => ({
          customerTaxStatuses: {
            ...state.customerTaxStatuses,
            [subscriberId]: status,
          },
        }));
      },

      removeCustomerTaxStatus: (subscriberId) => {
        set((state) => {
          const updated = { ...state.customerTaxStatuses };
          delete updated[subscriberId];
          return { customerTaxStatuses: updated };
        });
      },

      isCustomerTaxExempt: (subscriberId, jurisdictionKey) => {
        const status = get().customerTaxStatuses[subscriberId];
        return checkIsTaxExempt(status ?? null);
      },

      validateTaxCertificate: (subscriberId, certificateId) => {
        const status = get().customerTaxStatuses[subscriberId];
        if (!status) return false;
        if (!status.isExempt) return false;
        if (status.certificateId !== certificateId) return false;
        if (status.certificateExpiry && status.certificateExpiry < new Date()) return false;
        return true;
      },

      lookupTaxRate: (jurisdiction, digitalGoodsClass) => {
        const keys = jurisdictionFallbackKeys(jurisdiction);
        const rates = get().taxRates;
        for (const key of keys) {
          const entry = rates.find((r) => r.jurisdictionKey === key);
          if (entry) return entry;
        }
        return null;
      },

      resolveEffectiveTaxRateBps: (jurisdiction, digitalGoodsClass) => {
        const entry = get().lookupTaxRate(jurisdiction, digitalGoodsClass);
        return entry?.rateBps ?? get().config.defaultTaxRateBps;
      },

      addTaxRemittanceLine: (line) => {
        set((state) => ({
          taxRemittanceLines: [...state.taxRemittanceLines, line],
        }));
      },

      generateTaxRemittanceReport: (merchantId, periodStart, periodEnd, jurisdictions) => {
        const lines = get().taxRemittanceLines;
        const reportId = `rpt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

        const aggregated = new Map<string, TaxRemittanceLineItem>();
        for (const line of lines) {
          if (
            jurisdictions &&
            jurisdictions.length > 0 &&
            !jurisdictions.includes(line.jurisdictionKey)
          ) {
            continue;
          }
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

        const report: TaxRemittanceReport = {
          reportId,
          generatedAt: new Date(),
          periodStart,
          periodEnd,
          merchant: merchantId,
          lineItems,
          totalTaxCollected,
          totalTaxableAmount,
        };

        set((state) => ({
          taxRemittanceReports: [...state.taxRemittanceReports, report],
        }));

        return report;
      },

      getTaxRemittanceReports: () => get().taxRemittanceReports,

      getTaxRemittanceReport: (reportId) =>
        get().taxRemittanceReports.find((r) => r.reportId === reportId),

      setDigitalGoodsClass: (planId, goodsClass) => {
        set((state) => ({
          digitalGoodsClasses: {
            ...state.digitalGoodsClasses,
            [planId]: goodsClass,
          },
        }));
      },

      getDigitalGoodsClass: (planId) =>
        get().digitalGoodsClasses[planId] ?? DigitalGoodsClass.ELECTRONIC_SERVICE,

      calculateMidCycleTax: (jurisdictionKey, subtotal, periodStart, periodEnd, rateChanges) => {
        const periodDuration = periodEnd.getTime() - periodStart.getTime();
        if (periodDuration <= 0) return [];

        const relevant = rateChanges
          .filter((c) => c.effectiveFrom > periodStart && c.effectiveFrom < periodEnd)
          .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());

        if (relevant.length === 0) return [];

        const results: MidCycleTaxChange[] = [];
        let currentStart = periodStart;
        let currentRateBps: number | null = null;

        for (const change of relevant) {
          const segmentDuration = change.effectiveFrom.getTime() - currentStart.getTime();
          const segmentRatio = segmentDuration / periodDuration;
          const segmentSubtotal = Math.round(subtotal * segmentRatio);

          if (currentRateBps === null) {
            currentRateBps = change.oldRateBps;
          }

          const segmentTax = Math.round((segmentSubtotal * currentRateBps) / BPS_SCALE);

          results.push({
            jurisdictionKey,
            oldRateBps: currentRateBps,
            newRateBps: change.newRateBps,
            effectiveFrom: change.effectiveFrom,
            periodStart: currentStart,
            periodEnd: change.effectiveFrom,
            proratedTaxOld: segmentTax,
            proratedTaxNew: 0,
            totalTax: segmentTax,
          });

          currentStart = change.effectiveFrom;
          currentRateBps = change.newRateBps;
        }

        if (currentStart < periodEnd && currentRateBps !== null) {
          const remainingDuration = periodEnd.getTime() - currentStart.getTime();
          const remainingRatio = remainingDuration / periodDuration;
          const remainingSubtotal = Math.round(subtotal * remainingRatio);
          const remainingTax = Math.round((remainingSubtotal * currentRateBps) / BPS_SCALE);

          results.push({
            jurisdictionKey,
            oldRateBps: currentRateBps,
            newRateBps: currentRateBps,
            effectiveFrom: currentStart,
            periodStart: currentStart,
            periodEnd,
            proratedTaxOld: 0,
            proratedTaxNew: remainingTax,
            totalTax: remainingTax,
          });
        }

        return results;
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => debouncedAsyncStorage),
      partialize: (state) =>
        serializeForStorage({
          invoices: state.invoices,
          config: state.config,
          nextSequence: state.nextSequence,
          taxRates: state.taxRates,
          customerTaxStatuses: state.customerTaxStatuses,
          taxRemittanceLines: state.taxRemittanceLines,
          taxRemittanceReports: state.taxRemittanceReports,
          digitalGoodsClasses: state.digitalGoodsClasses,
        }),
      migrate: (persistedState) => migratePersistedState(persistedState),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...migratePersistedState(persistedState),
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          useInvoiceStore.setState({
            error: errorHandler.createError(
              new Error('Stored invoice data is corrupted. Loaded fallback data.'),
              { action: 'rehydrateInvoices' },
              true
            ),
            invoices: [],
            nextSequence: 1,
            config: DEFAULT_INVOICE_CONFIG,
            taxRates: [],
            customerTaxStatuses: {},
            taxRemittanceLines: [],
            taxRemittanceReports: [],
            digitalGoodsClasses: {},
            isLoading: false,
          });
          return;
        }

        useInvoiceStore.setState({
          invoices: state?.invoices ?? [],
          nextSequence: state?.nextSequence ?? 1,
          config: state?.config ?? DEFAULT_INVOICE_CONFIG,
          taxRates: state?.taxRates ?? [],
          customerTaxStatuses: state?.customerTaxStatuses ?? {},
          taxRemittanceLines: state?.taxRemittanceLines ?? [],
          taxRemittanceReports: state?.taxRemittanceReports ?? [],
          digitalGoodsClasses: state?.digitalGoodsClasses ?? {},
          isLoading: false,
          error: null,
        });
      },
    }
  )
);
