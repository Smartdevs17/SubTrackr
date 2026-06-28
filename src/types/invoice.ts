import { BillingCycle, Subscription, SubscriptionCategory } from './subscription';

export enum InvoiceStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  PARTIAL = 'partial',
  PAID = 'paid',
  VOID = 'void',
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
  description: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  exchangeRate: number;
  taxRateBps: number;
  lineTotal: number;
}

export interface InvoicePeriod {
  start: Date;
  end: Date;
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
  taxJurisdiction?: TaxJurisdiction;
  digitalGoodsCategory?: DigitalGoodsCategory;
  isTaxExempt?: boolean;
  taxExemptionId?: string;
  reverseCharge?: boolean;
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
}

export interface InvoiceTotals {
  subtotal: number;
  tax: number;
  total: number;
}

export interface InvoiceFormData {
  subscription: Subscription;
  period: InvoicePeriod;
  region?: string;
  currency?: string;
  recipientEmail?: string;
  notes?: string;
  taxJurisdiction?: TaxJurisdiction;
}

export interface InvoiceStateSnapshot {
  invoices: Invoice[];
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
