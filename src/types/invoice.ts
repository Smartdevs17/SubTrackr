import { BillingCycle, Subscription } from './subscription';

export enum InvoiceStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  PARTIAL = 'partial',
  PAID = 'paid',
  VOID = 'void',
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
}

export interface InvoiceConfig {
  numberingPrefix: string;
  numberingPadding: number;
  defaultCurrency: string;
  defaultRegion: string;
  defaultTaxRateBps: number;
  exchangeRateScale: number;
  paymentTermsDays: number;
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
};

export const isOpenInvoice = (status: InvoiceStatus): boolean =>
  status === InvoiceStatus.DRAFT || status === InvoiceStatus.SENT || status === InvoiceStatus.PARTIAL;

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
