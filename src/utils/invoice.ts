import { BillingCycle, Subscription } from '../types/subscription';
import {
  DEFAULT_INVOICE_CONFIG,
  Invoice,
  InvoiceConfig,
  InvoiceLineItem,
  InvoicePeriod,
  InvoiceStatus,
  InvoiceTotals,
} from '../types/invoice';
import { formatCurrency, formatDate } from './formatting';

const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;

export const calculateInvoiceTax = (subtotal: number, taxRateBps: number): number => {
  return Math.round((subtotal * taxRateBps) / 10_000);
};

export const convertCurrencyAmount = (
  amount: number,
  exchangeRate: number,
  scale: number = DEFAULT_INVOICE_CONFIG.exchangeRateScale
): number => {
  if (!Number.isFinite(amount) || !Number.isFinite(exchangeRate) || scale <= 0) {
    return 0;
  }
  return Math.round((amount * exchangeRate) / scale);
};

export const formatInvoiceNumber = (
  sequence: number,
  config: InvoiceConfig = DEFAULT_INVOICE_CONFIG
): string => {
  const padded = `${Math.max(sequence, 1)}`.padStart(config.numberingPadding, '0');
  return `${config.numberingPrefix}-${padded}`;
};

export const calculateInvoiceTotals = (
  lineItems: InvoiceLineItem[],
  taxRateBps: number
): InvoiceTotals => {
  const subtotal = lineItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const tax = calculateInvoiceTax(subtotal, taxRateBps);
  return {
    subtotal,
    tax,
    total: subtotal + tax,
  };
};

export const buildBillingPeriod = (subscription: Subscription): InvoicePeriod => {
  const end = new Date(subscription.nextBillingDate);
  const start = new Date(end.getTime());

  switch (subscription.billingCycle) {
    case BillingCycle.YEARLY:
      start.setFullYear(start.getFullYear() - 1);
      break;
    case BillingCycle.WEEKLY:
      start.setDate(start.getDate() - 7);
      break;
    case BillingCycle.CUSTOM:
      start.setMonth(start.getMonth() - 1);
      break;
    case BillingCycle.MONTHLY:
    default:
      start.setMonth(start.getMonth() - 1);
      break;
  }

  return { start, end };
};

export const buildInvoiceLineItem = (
  subscription: Subscription,
  config: InvoiceConfig = DEFAULT_INVOICE_CONFIG,
  exchangeRate = config.exchangeRateScale,
  taxRateBps = config.defaultTaxRateBps
): InvoiceLineItem => {
  const unitPrice = convertCurrencyAmount(subscription.price, exchangeRate, config.exchangeRateScale);

  return {
    description: subscription.name,
    quantity: 1,
    unitPrice,
    currency: config.defaultCurrency,
    exchangeRate,
    taxRateBps,
    lineTotal: unitPrice,
  };
};

export const buildInvoice = (
  subscription: Subscription,
  sequence: number,
  period: InvoicePeriod,
  config: InvoiceConfig = DEFAULT_INVOICE_CONFIG,
  taxRateBps = config.defaultTaxRateBps,
  exchangeRate = config.exchangeRateScale,
  region = config.defaultRegion,
  recipientEmail?: string,
  notes?: string
): Invoice => {
  const lineItem = buildInvoiceLineItem(subscription, config, exchangeRate, taxRateBps);
  const totals = calculateInvoiceTotals([lineItem], taxRateBps);
  const createdAt = new Date();
  const dueDate = new Date(period.end.getTime() + config.paymentTermsDays * DAY);

  return {
    id: `${subscription.id}-${sequence}`,
    invoiceNumber: formatInvoiceNumber(sequence, config),
    subscriptionId: subscription.id,
    subscriptionName: subscription.name,
    merchantName: subscription.description ?? subscription.name,
    lineItems: [lineItem],
    tax: totals.tax,
    total: totals.total,
    subtotal: totals.subtotal,
    dueDate,
    status: InvoiceStatus.DRAFT,
    currency: config.defaultCurrency,
    region,
    exchangeRate,
    period,
    createdAt,
    updatedAt: createdAt,
    recipientEmail,
    notes,
  };
};

export const generateInvoicePdfPreview = (invoice: Invoice): string => {
  const lines = [
    'SubTrackr Invoice',
    `Invoice: ${invoice.invoiceNumber}`,
    `Status: ${invoice.status}`,
    `Period: ${formatDate(invoice.period.start)} - ${formatDate(invoice.period.end)}`,
    `Due: ${formatDate(invoice.dueDate)}`,
    `Subtotal: ${formatCurrency(invoice.subtotal, invoice.currency)}`,
    `Tax: ${formatCurrency(invoice.tax, invoice.currency)}`,
    `Total: ${formatCurrency(invoice.total, invoice.currency)}`,
    'Items:',
    ...invoice.lineItems.map(
      (item) =>
        `${item.description} x${item.quantity} @ ${formatCurrency(item.unitPrice, item.currency)}`
    ),
  ];

  return lines.join('\n');
};
