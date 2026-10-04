import { BillingCycle, Subscription, SubscriptionCategory } from './subscription';

/**
 * Invoice lifecycle.
 *
 * This spans two sets that are both in active use: the billing states
 * (draft/sent/partial/paid/void) and the fulfilment states the reporting
 * layer relies on (pending/overdue/cancelled/refunded). Both are valid
 * members; which ones an invoice can occupy depends on how far it has been
 * taken through the workflow.
 */
export enum InvoiceStatus {
  // Billing states
  DRAFT = 'draft',
  SENT = 'sent',
  PARTIAL = 'partial',
  PAID = 'paid',
  VOID = 'void',
  // Fulfilment / reporting states
  PENDING = 'pending',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export enum TaxType {
  VAT = 'vat',
  GST = 'gst',
  SALES_TAX = 'sales_tax',
  DIGITAL_SERVICES_TAX = 'digital_services_tax',
  PST = 'pst',
  QST = 'qst',
  HST = 'hst',
  NONE = 'none',
}

export enum DigitalGoodsCategory {
  SAAS = 'saas',
  STREAMING = 'streaming',
  DIGITAL_DOWNLOAD = 'digital_download',
  CLOUD_STORAGE = 'cloud_storage',
  ONLINE_SERVICE = 'online_service',
  IN_APP_PURCHASE = 'in_app_purchase',
  MARKETPLACE = 'marketplace',
  OTHER = 'other',
}

// Backward-compatible alias used by stores/UI.
export type DigitalGoodsClass = DigitalGoodsCategory;

export enum CertificateStatus {
  PENDING = 'pending',
  VALID = 'valid',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
  INVALID = 'invalid',
}

export enum RemittanceStatus {
  DRAFT = 'draft',
  GENERATED = 'generated',
  SUBMITTED = 'submitted',
  PAID = 'paid',
  AMENDED = 'amended',
}

export interface TaxJurisdiction {
  country: string;
  state?: string;
  city?: string;
  postalCode?: string;
  taxType: TaxType;
  rateBps: number;
  label: string;
  effectiveDate: Date;
}

export interface TaxRateEntry {
  jurisdictionKey: string;
  taxType: TaxType;
  rateBps: number;
  displayName: string;
  effectiveFrom: Date;
  effectiveUntil: Date;
  appliesToDigitalGoods: boolean;
  reverseCharge: boolean;
  nexusThreshold: number;
}

export interface TaxRate {
  id: string;
  jurisdiction: TaxJurisdiction;
  rateBps: number;
  effectiveDate: Date;
  expiryDate?: Date;
}

export interface TaxRateChangeEvent {
  id: string;
  jurisdictionKey: string;
  oldRateBps: number;
  newRateBps: number;
  changedAt: Date;
  effectiveFrom: Date;
}

export interface TaxExemption {
  id: string;
  customerId: string;
  certificateNumber: string;
  issuingAuthority: string;
  validFrom: Date;
  validUntil: Date;
  jurisdictions: TaxJurisdiction[];
  status: CertificateStatus;
  validatedAt?: Date;
  validatedBy?: string;
}

export interface CustomerTaxStatus {
  isExempt: boolean;
  certificateId: string;
  certificateExpiry: Date;
  issuingAuthority: string;
  exemptJurisdictions: string[];
}

export interface TaxCalculationInput {
  subscriptionId: string;
  subtotal: number;
  currency: string;
  jurisdiction: TaxJurisdiction;
  digitalGoodsCategory: DigitalGoodsCategory;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  isTaxExempt?: boolean;
  exemptionId?: string;
  rateChangeEvent?: TaxRateChangeEvent;
}

export interface TaxCalculationResult {
  taxAmount: number;
  taxRateBps: number;
  taxableAmount: number;
  jurisdiction: TaxJurisdiction;
  isExempt: boolean;
  effectiveDate: Date;
  proration?: {
    preChangeAmount: number;
    postChangeAmount: number;
    preChangeDays: number;
    postChangeDays: number;
  };
}

export interface MidCycleTaxChange {
  jurisdictionKey: string;
  oldRateBps: number;
  newRateBps: number;
  effectiveFrom: Date;
  periodStart: Date;
  periodEnd: Date;
  proratedTaxOld: number;
  proratedTaxNew: number;
  totalTax: number;
}

export interface TaxRemittanceLineItem {
  invoiceId: string;
  invoiceNumber: string;
  subscriptionId: string;
  customerId: string;
  jurisdictionKey: string;
  taxType: TaxType;
  taxableAmount: number;
  rateBps: number;
  taxCollected: number;
  transactionCount?: number;
  currency: string;
  digitalGoodsCategory?: DigitalGoodsCategory;
  invoiceDate: Date;
}

export interface TaxRemittanceReport {
  id: string;
  reportId: string;
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  merchant: string;
  jurisdiction: TaxJurisdiction;
  lineItems: TaxRemittanceLineItem[];
  totalTaxCollected: number;
  totalTaxableAmount: number;
  totalTaxRemitted: number;
  transactionCount: number;
  status: RemittanceStatus;
  submittedAt?: Date;
  notes?: string;
}

export interface NexusRegion {
  country: string;
  state?: string;
  city?: string;
  thresholdMet: boolean;
  thresholdAmount: number;
  transactionsInPeriod: number;
  totalRevenueInPeriod: number;
  firstNexusDate?: Date;
  taxType: TaxType;
}

export interface NexusReport {
  merchantId: string;
  jurisdictionKey: string;
  isEstablished: boolean;
  totalRevenue: number;
  thresholdAmount: number;
  assessedAt: Date;
}

export interface TaxRateCacheEntry {
  jurisdictionKey: string;
  rate: number;
  taxType: TaxType;
  cachedAt: Date;
  ttlSeconds: number;
}

export interface DigitalGoodsTaxRule {
  classification: DigitalGoodsCategory;
  country: string;
  state?: string;
  isTaxable: boolean;
  reducedRate?: number;
  notes: string;
}

export interface TaxInvoiceGenerationInput {
  subscription: Subscription;
  jurisdiction: TaxJurisdiction;
  taxType: TaxType;
  isExempt: boolean;
  digitalGoodsCategory: DigitalGoodsCategory;
  effectiveTaxRateBps: number;
  reverseCharge?: boolean;
}

export interface InvoiceLineItem {
  /** Optional line identifier assigned by the caller. */
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  exchangeRate: number;
  taxRateBps: number;
  lineTotal?: number;
  /** Alias of `lineTotal`, accepted from the flat invoice form shape. */
  amount?: number;
}

export interface InvoicePeriod {
  start: Date;
  end: Date;
}

export interface InvoiceBranding {
  /** Identifier used when persisting a branding profile. */
  id?: string;
  /** Merchant name shown in the invoice header. */
  companyName?: string;
  /** Logo asset. `logoUrl` is the canonical field; `companyLogo` is the alias
   *  used by the invoice service and older screens. */
  logoUrl?: string;
  companyLogo?: string;
  /** Where the logo is anchored in the rendered header. */
  logoPosition?: 'left' | 'center' | 'right';
  createdAt?: Date;
  updatedAt?: Date;
  primaryColor?: string;
  fontFamily?: string;
  /** Used for secondary surfaces (table headers, rules) in rendered invoices. */
  secondaryColor?: string;
  accentColor?: string;
  /** Body text colour; falls back to a neutral when unset. */
  textColor?: string;
  /** Displayed under the totals block — payment terms, legal footer, etc. */
  footerText?: string;
  supportEmail?: string;
  websiteUrl?: string;
  /** Rendered logo width in points. Clamped when the invoice is rendered. */
  logoWidth?: number;
}

export interface InvoiceTemplate {
  id: string;
  name: string;
  /** Human-readable description shown in the template picker. */
  description?: string;
  /**
   * Template layout. Accepts the `InvoiceLayout` enum as well as the raw
   * layout names that are persisted in existing tenant configurations.
   */
  layout: InvoiceLayout | 'standard' | 'minimalist' | 'creative' | 'premium';
  /** Template used when a tenant has not chosen one. */
  isDefault?: boolean;
  headerContent?: string;
  footerContent?: string;
  includeNotes?: boolean;
  includePaymentTerms?: boolean;
  /** Render the merchant signature block in the footer. */
  includeSignature?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * A tenant's invoice presentation. Tenants are merchants on the platform, so
 * one deployment renders invoices under many brands; anything left unset here
 * falls back to the platform defaults in `InvoiceConfig`.
 */
export interface TenantBrandingProfile {
  tenantId: string;
  /** Legal entity name printed as the issuer. Defaults to the merchant name. */
  displayName?: string;
  branding: InvoiceBranding;
  /** Overrides `InvoiceConfig.defaultTemplateId` for this tenant. */
  templateId?: string;
  /** Overrides the platform invoice number prefix, e.g. `ACME`. */
  numberingPrefix?: string;
  updatedAt?: Date;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  subscriptionId: string;
  subscriptionName: string;
  merchantName: string;
  lineItems: InvoiceLineItem[];
  tax: number;
  total: number;
  subtotal: number;
  dueDate: Date;
  status: InvoiceStatus;
  currency: string;
  region: string;
  exchangeRate: number;
  period: InvoicePeriod;
  createdAt: Date;
  updatedAt: Date;
  recipientEmail?: string;
  notes?: string;
  /** Date the invoice was issued. Distinct from `createdAt`. */
  issueDate?: Date;
  /** Sum of line-item discounts, in `currency` units. */
  discountAmount?: number;
  /** Rendered payment-terms text, e.g. "Net 14". */
  paymentTerms?: string;
  /** How the invoice was (or is expected to be) settled. */
  paymentMethod?: string;
  /** Billed party, shown in the "Bill to" block. */
  customerName?: string;
  customerEmail?: string;
  /** Location of the generated PDF, once rendered. */
  pdfUrl?: string;
  /** Alias of `total`, accepted from the flat invoice form shape. */
  totalAmount?: number;
  /** Alias of `total` used by the flat invoice form shape. */
  amount?: number;
  taxJurisdiction?: TaxJurisdiction;
  digitalGoodsCategory?: DigitalGoodsCategory;
  isTaxExempt?: boolean;
  taxExemptionId?: string;
  reverseCharge?: boolean;
  branding?: InvoiceBranding;
  templateId?: string;
  tenantId?: string;
}

export interface InvoiceConfig {
  numberingPrefix: string;
  numberingPadding: number;
  defaultCurrency: string;
  defaultRegion: string;
  defaultTaxRateBps: number;
  exchangeRateScale: number;
  paymentTermsDays: number;
  defaultTaxType: TaxType;
  defaultBranding?: InvoiceBranding;
  defaultTemplateId?: string;
}

/** Branding actually applied to an invoice, with the source of each decision. */
export interface ResolvedInvoiceBranding {
  branding: InvoiceBranding;
  templateId: string;
  displayName?: string;
  numberingPrefix: string;
  /** Which layer supplied the branding — useful for the branding preview UI. */
  source: 'tenant' | 'platform' | 'fallback';
}

export interface InvoiceTotals {
  subtotal: number;
  tax: number;
  total: number;
}

export interface InvoiceFormData {
  subscription?: Subscription;
  period?: InvoicePeriod;
  /** Flat identifier, used when the full subscription is not loaded. */
  subscriptionId?: string;
  /** Flat invoice amount, used when line items are not supplied. */
  amount?: number;
  /** Line items being invoiced; totals are derived from these. */
  lineItems?: InvoiceLineItem[];
  /** Tax to apply, in `currency` units. Derived from the tax jurisdiction when omitted. */
  taxAmount?: number;
  /** Discount to subtract, in `currency` units. */
  discountAmount?: number;
  /** Payment due date; becomes `Invoice.period.end`. */
  dueDate?: Date;
  region?: string;
  currency?: string;
  recipientEmail?: string;
  notes?: string;
  taxJurisdiction?: TaxJurisdiction;
  /** Merchant whose branding profile should be applied to this invoice. */
  tenantId?: string;
}

export interface InvoiceStateSnapshot {
  invoices: Invoice[];
}

/** Visual template applied when rendering an invoice. */
export enum InvoiceLayout {
  MODERN = 'modern',
  CLASSIC = 'classic',
  MINIMAL = 'minimal',
}

/** Optional narrowing applied by `getAllInvoices`. */
export interface InvoiceFilters {
  status?: InvoiceStatus[];
  subscriptionId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  minAmount?: number;
  maxAmount?: number;
}

/** Input for `generateInvoicePDF`. */
export interface PDFGenerationOptions {
  invoiceId: string;
}

/** Rendered preview returned by `previewInvoice`. */
export interface InvoicePreview {
  invoiceId: string;
  html: string;
  brandingApplied: boolean;
  templateApplied: boolean;
}

/** A subscription ranked by revenue in `getInvoiceAnalytics`. */
export interface InvoiceSubscriptionRevenue {
  subscriptionId: string;
  subscriptionName: string;
  revenue: number;
  invoiceCount: number;
}

/** Aggregate invoice statistics returned by `getInvoiceAnalytics`. */
export interface InvoiceAnalytics {
  totalInvoices: number;
  totalRevenue: number;
  paidInvoices: number;
  pendingInvoices: number;
  overdueInvoices: number;
  averageInvoiceAmount: number;
  /** Revenue keyed by `YYYY-MM`. */
  revenueByMonth: Record<string, number>;
  statusBreakdown: Record<InvoiceStatus, number>;
  paymentMethodBreakdown: Record<string, number>;
  topSubscriptions: InvoiceSubscriptionRevenue[];
}

export const DEFAULT_INVOICE_CONFIG: InvoiceConfig = {
  numberingPrefix: 'INV',
  numberingPadding: 6,
  defaultCurrency: 'USD',
  defaultRegion: 'GLOBAL',
  defaultTaxRateBps: 0,
  exchangeRateScale: 1_000_000,
  paymentTermsDays: 14,
  defaultTaxType: TaxType.NONE,
};

export const isOpenInvoice = (status: InvoiceStatus): boolean =>
  status === InvoiceStatus.DRAFT ||
  status === InvoiceStatus.SENT ||
  status === InvoiceStatus.PARTIAL;

export const billingCycleToMonths = (cycle: BillingCycle): number => {
  switch (cycle) {
    case BillingCycle.YEARLY:
      return 12;
    case BillingCycle.WEEKLY:
      return 1 / 4.345;
    case BillingCycle.CUSTOM:
      return 1;
    case BillingCycle.MONTHLY:
    default:
      return 1;
  }
};

export const buildJurisdictionKey = (jurisdiction: {
  country: string;
  state?: string;
  city?: string;
}): string => {
  const parts = [jurisdiction.country];
  if (jurisdiction.state) parts.push(jurisdiction.state);
  if (jurisdiction.city) parts.push(jurisdiction.city);
  return parts.join('::');
};

export const isTaxExempt = (status: CustomerTaxStatus | null): boolean => {
  if (!status) return false;
  if (!status.isExempt) return false;
  if (status.certificateExpiry && status.certificateExpiry < new Date()) return false;
  return true;
};

export const mapSubscriptionCategoryToDigitalGoods = (
  category: SubscriptionCategory
): DigitalGoodsCategory => {
  switch (category) {
    case SubscriptionCategory.STREAMING:
      return DigitalGoodsCategory.STREAMING;
    case SubscriptionCategory.SOFTWARE:
    case SubscriptionCategory.PRODUCTIVITY:
      return DigitalGoodsCategory.SAAS;
    case SubscriptionCategory.GAMING:
      return DigitalGoodsCategory.IN_APP_PURCHASE;
    case SubscriptionCategory.FINANCE:
      return DigitalGoodsCategory.ONLINE_SERVICE;
    case SubscriptionCategory.EDUCATION:
    case SubscriptionCategory.FITNESS:
    case SubscriptionCategory.OTHER:
    default:
      return DigitalGoodsCategory.OTHER;
  }
};
