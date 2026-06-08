export type TaxType =
  | 'none'
  | 'vat'
  | 'gst'
  | 'sales_tax'
  | 'digital_services_tax'
  | 'pst'
  | 'qst'
  | 'hst';

export type DigitalGoodsClass =
  | 'standard'
  | 'electronic_service'
  | 'exempt'
  | 'reduced_rate'
  | 'telecom_service';

export interface TaxJurisdiction {
  country: string;
  state: string;
  city: string;
}

export interface TaxRateEntry {
  jurisdictionKey: string;
  taxType: TaxType;
  rateBps: number;
  displayName: string;
  effectiveFrom: number;
  effectiveUntil: number;
  appliesToDigitalGoods: boolean;
  reverseCharge: boolean;
  nexusThreshold: number;
}

export interface TaxRateChangeEvent {
  jurisdictionKey: string;
  oldRateBps: number;
  newRateBps: number;
  changedAt: number;
  effectiveFrom: number;
}

export interface CustomerTaxStatus {
  isExempt: boolean;
  certificateId: string;
  certificateExpiry: number;
  issuingAuthority: string;
  exemptJurisdictions: string[];
  digitalGoodsOverride?: DigitalGoodsClass;
}

export interface TaxRemittanceLineItem {
  jurisdictionKey: string;
  taxType: TaxType;
  taxableAmount: number;
  rateBps: number;
  taxCollected: number;
  transactionCount: number;
  currency: string;
}

export interface TaxRemittanceReport {
  reportId: string;
  generatedAt: number;
  periodStart: number;
  periodEnd: number;
  merchantId: string;
  lineItems: TaxRemittanceLineItem[];
  totalTaxCollected: number;
  totalTaxableAmount: number;
}

export interface TaxRateCacheEntry {
  jurisdictionKey: string;
  entry: TaxRateEntry;
  cachedAt: number;
  ttlMs: number;
}

export interface NexusReport {
  merchantId: string;
  jurisdictionKey: string;
  isEstablished: boolean;
  totalRevenue: number;
  thresholdAmount: number;
  assessedAt: number;
}

export interface MidCycleTaxChange {
  jurisdictionKey: string;
  oldRateBps: number;
  newRateBps: number;
  effectiveFrom: number;
  periodStart: number;
  periodEnd: number;
  proratedTaxOld: number;
  proratedTaxNew: number;
  totalTax: number;
}

export interface DigitalGoodsTaxRule {
  classification: DigitalGoodsClass;
  country: string;
  state?: string;
  isTaxable: boolean;
  reducedRateBps?: number;
  notes: string;
}

export interface TaxCalculationResult {
  taxAmount: number;
  taxRateBps: number;
  taxType: TaxType;
  jurisdictionKey: string;
  isExempt: boolean;
  isReverseCharge: boolean;
  midCycleChanges: MidCycleTaxChange[];
}

export interface TaxInvoiceContext {
  subscriptionId: string;
  planId: string;
  merchantId: string;
  subscriberId: string;
  jurisdiction: TaxJurisdiction;
  subtotal: number;
  currency: string;
  periodStart: number;
  periodEnd: number;
  digitalGoodsClass: DigitalGoodsClass;
}

export interface TaxRemittanceReportRequest {
  merchantId: string;
  periodStart: number;
  periodEnd: number;
  format: 'summary' | 'detailed';
  jurisdictions?: string[];
}

export const DEFAULT_TAX_CACHE_TTL_MS = 3_600_000; // 1 hour
export const TAX_RATE_CACHE_MAX_ENTRIES = 10_000;
