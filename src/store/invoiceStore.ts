import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { debouncedAsyncStorageAdapter } from '../utils/storage';
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
  DigitalGoodsCategory,
  InvoiceBranding,
  InvoiceTemplate,
  TenantBrandingProfile,
  ResolvedInvoiceBranding,
  RemittanceStatus,
  TaxRateEntry,
  MidCycleTaxChange,
  TaxInvoiceGenerationInput,
  buildJurisdictionKey,
  isTaxExempt as checkIsTaxExempt,
} from '../types/invoice';
import { buildInvoice, calculateInvoiceTotals } from '../utils/invoice';
import { errorHandler, AppError } from '../services/errorHandler';
import { presentLocalNotification } from '../services/notificationService';

const STORAGE_KEY = 'subtrackr-invoices';
const STORE_VERSION = 2;

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
  | 'brandingProfiles'
  | 'templates'
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
    branding: raw.branding,
    templateId: raw.templateId,
    tenantId: raw.tenantId,
  };
};

const DEFAULT_TEMPLATES: InvoiceTemplate[] = [
  { id: 'tpl-1', name: 'Standard', layout: 'standard' },
  { id: 'tpl-2', name: 'Modern', layout: 'modern' },
  { id: 'tpl-3', name: 'Minimalist', layout: 'minimalist' },
];

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Only http(s) and data-image URLs may be embedded in a rendered invoice. */
const isSafeLogoUrl = (url: string): boolean =>
  /^https?:\/\//i.test(url) || /^data:image\//i.test(url);

/**
 * Reports every problem with a branding payload rather than throwing on the
 * first, so the branding editor can highlight all offending fields at once.
 */
export const validateInvoiceBranding = (branding: InvoiceBranding): string[] => {
  const errors: string[] = [];
  const colorFields: [keyof InvoiceBranding, string][] = [
    ['primaryColor', 'primaryColor'],
    ['secondaryColor', 'secondaryColor'],
    ['accentColor', 'accentColor'],
    ['textColor', 'textColor'],
  ];
  for (const [field, label] of colorFields) {
    const value = branding[field];
    if (value !== undefined && !HEX_COLOR.test(String(value))) {
      errors.push(`${label} must be a hex colour such as #1a73e8`);
    }
  }
  if (branding.logoUrl !== undefined && !isSafeLogoUrl(branding.logoUrl)) {
    errors.push('logoUrl must be an http(s) or data:image URL');
  }
  if (
    branding.logoWidth !== undefined &&
    (!Number.isFinite(branding.logoWidth) || branding.logoWidth <= 0)
  ) {
    errors.push('logoWidth must be a positive number');
  }
  if (
    branding.supportEmail !== undefined &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(branding.supportEmail)
  ) {
    errors.push('supportEmail must be a valid email address');
  }
  if (branding.websiteUrl !== undefined && !/^https?:\/\//i.test(branding.websiteUrl)) {
    errors.push('websiteUrl must be an http(s) URL');
  }
  return errors;
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
  brandingProfiles: state.brandingProfiles,
  templates: state.templates,
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
      brandingProfiles: {},
      templates: DEFAULT_TEMPLATES,
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
    // v1 stores predate per-tenant branding; an empty registry falls back to
    // the platform defaults, which is exactly the v1 behaviour.
    brandingProfiles: maybeState.brandingProfiles ?? {},
    templates:
      Array.isArray(maybeState.templates) && maybeState.templates.length > 0
        ? maybeState.templates
        : DEFAULT_TEMPLATES,
  };
};

// Debounced writes are provided by the shared debouncedAsyncStorageAdapter
// (see src/utils/storage.ts). This removes the copy-pasted boilerplate.

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
  digitalGoodsClasses: Record<string, DigitalGoodsCategory>;

  templates: InvoiceTemplate[];
  /** Per-tenant invoice presentation, keyed by tenant (merchant) id. */
  brandingProfiles: Record<string, TenantBrandingProfile>;

  setInvoiceBranding: (branding: InvoiceBranding) => void;
  setDefaultTemplate: (templateId: string) => void;
  addTemplate: (template: InvoiceTemplate) => void;
  removeTemplate: (templateId: string) => void;

  setTenantBranding: (
    tenantId: string,
    profile: Omit<TenantBrandingProfile, 'tenantId' | 'updatedAt'>
  ) => TenantBrandingProfile;
  updateTenantBranding: (
    tenantId: string,
    patch: Partial<Omit<TenantBrandingProfile, 'tenantId'>>
  ) => TenantBrandingProfile | null;
  removeTenantBranding: (tenantId: string) => void;
  getTenantBranding: (tenantId: string) => TenantBrandingProfile | undefined;
  listTenantBranding: () => TenantBrandingProfile[];
  resolveBranding: (tenantId?: string) => ResolvedInvoiceBranding;
  applyBrandingToInvoice: (invoiceId: string, tenantId?: string) => Invoice | null;

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
    digitalGoodsClass?: DigitalGoodsCategory
  ) => TaxRateEntry | null;
  resolveEffectiveTaxRateBps: (
    jurisdiction: TaxJurisdiction,
    digitalGoodsClass?: DigitalGoodsCategory
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

  setDigitalGoodsClass: (planId: string, goodsClass: DigitalGoodsCategory) => void;
  getDigitalGoodsClass: (planId: string) => DigitalGoodsCategory;

  calculateMidCycleTax: (
    jurisdictionKey: string,
    subtotal: number,
    periodStart: Date,
    periodEnd: Date,
    rateChanges: {
      oldRateBps: number;
      newRateBps: number;
      effectiveFrom: Date;
    }[]
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

      templates: DEFAULT_TEMPLATES,
      brandingProfiles: {},

      setInvoiceBranding: (branding) => {
        set((state) => ({
          config: { ...state.config, defaultBranding: branding },
        }));
      },

      setDefaultTemplate: (templateId) => {
        set((state) => ({
          config: { ...state.config, defaultTemplateId: templateId },
        }));
      },

      addTemplate: (template) => {
        set((state) => ({
          templates: state.templates.some((t) => t.id === template.id)
            ? state.templates.map((t) => (t.id === template.id ? template : t))
            : [...state.templates, template],
        }));
      },

      removeTemplate: (templateId) => {
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== templateId),
          // Never leave the config pointing at a template that no longer exists.
          config:
            state.config.defaultTemplateId === templateId
              ? { ...state.config, defaultTemplateId: undefined }
              : state.config,
        }));
      },

      setTenantBranding: (tenantId, profile) => {
        const errors = validateInvoiceBranding(profile.branding);
        if (errors.length > 0) {
          throw new Error(`Invalid branding for tenant ${tenantId}: ${errors.join('; ')}`);
        }
        const stored: TenantBrandingProfile = {
          ...profile,
          tenantId,
          updatedAt: new Date(),
        };
        set((state) => ({
          brandingProfiles: { ...state.brandingProfiles, [tenantId]: stored },
        }));
        return stored;
      },

      updateTenantBranding: (tenantId, patch) => {
        const existing = get().brandingProfiles[tenantId];
        if (!existing) return null;

        const branding = patch.branding
          ? { ...existing.branding, ...patch.branding }
          : existing.branding;
        const errors = validateInvoiceBranding(branding);
        if (errors.length > 0) {
          throw new Error(`Invalid branding for tenant ${tenantId}: ${errors.join('; ')}`);
        }

        const merged: TenantBrandingProfile = {
          ...existing,
          ...patch,
          branding,
          tenantId,
          updatedAt: new Date(),
        };
        set((state) => ({
          brandingProfiles: { ...state.brandingProfiles, [tenantId]: merged },
        }));
        return merged;
      },

      removeTenantBranding: (tenantId) => {
        set((state) => {
          if (!state.brandingProfiles[tenantId]) return state;
          const updated = { ...state.brandingProfiles };
          delete updated[tenantId];
          return { brandingProfiles: updated };
        });
      },

      getTenantBranding: (tenantId) => get().brandingProfiles[tenantId],

      listTenantBranding: () => Object.values(get().brandingProfiles),

      resolveBranding: (tenantId) => {
        const state = get();
        const platformBranding = state.config.defaultBranding;
        const platformTemplate =
          state.config.defaultTemplateId ?? state.templates[0]?.id ?? DEFAULT_TEMPLATES[0].id;
        const profile = tenantId ? state.brandingProfiles[tenantId] : undefined;

        if (!profile) {
          return {
            branding: platformBranding ?? {},
            templateId: platformTemplate,
            numberingPrefix: state.config.numberingPrefix,
            source: platformBranding ? 'platform' : 'fallback',
          };
        }

        // Tenant values win field by field, so a tenant that only overrides its
        // logo still inherits the platform palette.
        const branding: InvoiceBranding = { ...(platformBranding ?? {}), ...profile.branding };

        // A tenant pointing at a template that has since been deleted falls
        // back rather than rendering nothing.
        const templateId =
          profile.templateId && state.templates.some((t) => t.id === profile.templateId)
            ? profile.templateId
            : platformTemplate;

        return {
          branding,
          templateId,
          displayName: profile.displayName,
          numberingPrefix: profile.numberingPrefix ?? state.config.numberingPrefix,
          source: 'tenant',
        };
      },

      applyBrandingToInvoice: (invoiceId, tenantId) => {
        const invoice = get().invoices.find((entry) => entry.id === invoiceId);
        if (!invoice) return null;

        const effectiveTenantId = tenantId ?? invoice.tenantId;
        const resolved = get().resolveBranding(effectiveTenantId);
        const updated: Invoice = {
          ...invoice,
          tenantId: effectiveTenantId,
          branding: resolved.branding,
          templateId: resolved.templateId,
          merchantName: resolved.displayName ?? invoice.merchantName,
          updatedAt: new Date(),
        };

        set((state) => ({
          invoices: state.invoices.map((entry) => (entry.id === invoiceId ? updated : entry)),
        }));
        return updated;
      },

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

          const resolved = get().resolveBranding(data.tenantId);
          invoice.tenantId = data.tenantId;
          invoice.branding = resolved.branding;
          invoice.templateId = resolved.templateId;
          if (resolved.displayName) {
            invoice.merchantName = resolved.displayName;
          }
          if (resolved.numberingPrefix !== state.config.numberingPrefix) {
            invoice.invoiceNumber = invoice.invoiceNumber.replace(
              state.config.numberingPrefix,
              resolved.numberingPrefix
            );
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

      isCustomerTaxExempt: (subscriberId, _jurisdictionKey) => {
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

      lookupTaxRate: (jurisdiction, _digitalGoodsClass) => {
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
            existing.transactionCount =
              (existing.transactionCount ?? 0) + (line.transactionCount ?? 1);
          } else {
            aggregated.set(groupKey, { ...line, transactionCount: line.transactionCount ?? 1 });
          }
        }

        const lineItems = Array.from(aggregated.values());
        const totalTaxCollected = lineItems.reduce((sum, l) => sum + l.taxCollected, 0);
        const totalTaxableAmount = lineItems.reduce((sum, l) => sum + l.taxableAmount, 0);
        const transactionCount = lineItems.reduce((sum, l) => sum + (l.transactionCount ?? 0), 0);

        const primaryLine = lineItems[0];
        const jurisdictionParts = primaryLine?.jurisdictionKey?.split('::') ?? [];
        const jurisdiction: TaxJurisdiction = {
          country: jurisdictionParts[0] ?? 'Unknown',
          state: jurisdictionParts[1],
          city: jurisdictionParts[2],
          taxType: primaryLine?.taxType ?? get().config.defaultTaxType,
          rateBps: primaryLine?.rateBps ?? 0,
          label: primaryLine?.jurisdictionKey ?? 'Unknown',
          effectiveDate: periodStart,
        };

        const report: TaxRemittanceReport = {
          id: reportId,
          reportId,
          generatedAt: new Date(),
          periodStart,
          periodEnd,
          merchant: merchantId,
          jurisdiction,
          lineItems,
          totalTaxCollected,
          totalTaxableAmount,
          totalTaxRemitted: 0,
          transactionCount,
          status: RemittanceStatus.DRAFT,
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
        get().digitalGoodsClasses[planId] ?? DigitalGoodsCategory.ONLINE_SERVICE,

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
      storage: createJSONStorage(() => debouncedAsyncStorageAdapter),
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
          brandingProfiles: state.brandingProfiles,
          templates: state.templates,
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
            brandingProfiles: {},
            templates: DEFAULT_TEMPLATES,
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
          brandingProfiles: state?.brandingProfiles ?? {},
          templates:
            state?.templates && state.templates.length > 0 ? state.templates : DEFAULT_TEMPLATES,
          isLoading: false,
          error: null,
        });
      },
    }
  )
);
