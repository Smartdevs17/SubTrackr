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
} from '../types/invoice';
import { buildBillingPeriod, buildInvoice, calculateInvoiceTotals } from '../utils/invoice';
import { CACHE_CONSTANTS } from '../utils/constants/values';
import { errorHandler, AppError } from '../services/errorHandler';
import { presentLocalNotification } from '../services/notificationService';

const STORAGE_KEY = 'subtrackr-invoices';
const STORE_VERSION = 1;
const WRITE_DEBOUNCE_MS = CACHE_CONSTANTS.WRITE_DEBOUNCE_MS;

type PersistedInvoiceSlice = Pick<InvoiceState, 'invoices' | 'config' | 'nextSequence'>;

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
});

const migratePersistedState = (persisted: unknown): PersistedInvoiceSlice => {
  if (!persisted || typeof persisted !== 'object') {
    return {
      invoices: [],
      config: DEFAULT_INVOICE_CONFIG,
      nextSequence: 1,
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

interface InvoiceState {
  invoices: Invoice[];
  config: InvoiceConfig;
  nextSequence: number;
  isLoading: boolean;
  error: AppError | null;

  generateInvoiceFromSubscription: (
    data: InvoiceFormData,
    taxRateBps?: number,
    exchangeRate?: number
  ) => Promise<Invoice>;
  updateInvoiceStatus: (id: string, status: InvoiceStatus) => Promise<void>;
  voidInvoice: (id: string) => Promise<void>;
  sendInvoice: (id: string, recipientEmail?: string) => Promise<void>;
  markInvoicePaid: (id: string) => Promise<void>;
  setTaxRate: (region: string, taxRateBps: number) => void;
  setExchangeRate: (currency: string, exchangeRate: number) => void;
  calculateTotals: (id: string) => InvoiceTotals | null;
}

const applyInvoiceStatus = (invoices: Invoice[], id: string, status: InvoiceStatus): Invoice[] =>
  invoices.map((invoice) =>
    invoice.id === id ? { ...invoice, status, updatedAt: new Date() } : invoice
  );

export const useInvoiceStore = create<InvoiceState>()(
  persist(
    (set, get) => ({
      invoices: [],
      config: DEFAULT_INVOICE_CONFIG,
      nextSequence: 1,
      isLoading: false,
      error: null,

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
            isLoading: false,
          });
          return;
        }

        useInvoiceStore.setState({
          invoices: state?.invoices ?? [],
          nextSequence: state?.nextSequence ?? 1,
          config: state?.config ?? DEFAULT_INVOICE_CONFIG,
          isLoading: false,
          error: null,
        });
      },
    }
  )
);
