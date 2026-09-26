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
import { MeterUsageBreakdown } from '../types/usage';
import { formatCurrency, formatDate } from './formatting';
import { ProrationPreview, buildProrationLineItem } from './proration';

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
  const unitPrice = convertCurrencyAmount(
    subscription.price,
    exchangeRate,
    config.exchangeRateScale
  );

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

/** Builds one invoice line item per metered usage breakdown (issue #554). */
export const buildUsageLineItems = (
  breakdowns: MeterUsageBreakdown[],
  config: InvoiceConfig = DEFAULT_INVOICE_CONFIG,
  exchangeRate = config.exchangeRateScale,
  taxRateBps = config.defaultTaxRateBps
): InvoiceLineItem[] =>
  breakdowns
    .filter((b) => b.billableUnits > 0)
    .map((b) => {
      const unitPrice = b.billableUnits > 0 ? Math.round(b.amount / b.billableUnits) : 0;
      return {
        description: `${b.metric} usage (${b.billableUnits.toLocaleString()} billable of ${b.unitsUsed.toLocaleString()} units, ${b.includedUnits.toLocaleString()} included)`,
        quantity: b.billableUnits,
        unitPrice,
        currency: config.defaultCurrency,
        exchangeRate,
        taxRateBps,
        lineTotal: b.amount,
      };
    });

/** Builds a base subscription invoice plus per-meter usage line items (issue #554). */
export const buildInvoiceWithUsage = (
  subscription: Subscription,
  sequence: number,
  period: InvoicePeriod,
  usageBreakdowns: MeterUsageBreakdown[],
  config: InvoiceConfig = DEFAULT_INVOICE_CONFIG,
  taxRateBps = config.defaultTaxRateBps,
  exchangeRate = config.exchangeRateScale,
  region = config.defaultRegion,
  recipientEmail?: string,
  notes?: string
): Invoice => {
  const baseLineItem = buildInvoiceLineItem(subscription, config, exchangeRate, taxRateBps);
  const usageLineItems = buildUsageLineItems(usageBreakdowns, config, exchangeRate, taxRateBps);
  const lineItems = [baseLineItem, ...usageLineItems];

  const totals = calculateInvoiceTotals(lineItems, taxRateBps);
  const createdAt = new Date();
  const dueDate = new Date(period.end.getTime() + config.paymentTermsDays * DAY);

  return {
    id: `${subscription.id}-${sequence}`,
    invoiceNumber: formatInvoiceNumber(sequence, config),
    subscriptionId: subscription.id,
    subscriptionName: subscription.name,
    merchantName: subscription.description ?? subscription.name,
    lineItems,
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

/**
 * Builds a single consolidated invoice covering multiple subscriptions that
 * share a billing date (issue #566). Free subscriptions are excluded.
 */
export const buildConsolidatedInvoice = (
  subscriptions: Subscription[],
  sequence: number,
  period: InvoicePeriod,
  config: InvoiceConfig = DEFAULT_INVOICE_CONFIG,
  taxRateBps = config.defaultTaxRateBps,
  exchangeRate = config.exchangeRateScale,
  region = config.defaultRegion,
  recipientEmail?: string
): Invoice => {
  const billable = subscriptions.filter((s) => s.price > 0);
  const lineItems = billable.map((s) => buildInvoiceLineItem(s, config, exchangeRate, taxRateBps));
  const totals = calculateInvoiceTotals(lineItems, taxRateBps);
  const createdAt = new Date();
  const dueDate = new Date(period.end.getTime() + config.paymentTermsDays * DAY);
  const primary = billable[0];

  return {
    id: `consolidated-${sequence}`,
    invoiceNumber: formatInvoiceNumber(sequence, config),
    subscriptionId: billable.map((s) => s.id).join(','),
    subscriptionName: `Consolidated (${billable.length} subscriptions)`,
    merchantName: primary?.description ?? primary?.name ?? 'Consolidated invoice',
    lineItems,
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
    notes: `Consolidated billing for: ${billable.map((s) => s.name).join(', ')}`,
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

//added new function:
export const buildProratedInvoice = (
  subscription: Subscription,
  sequence: number,
  period: InvoicePeriod,
  prorationPreview: ProrationPreview | null,
  config: InvoiceConfig = DEFAULT_INVOICE_CONFIG,
  taxRateBps = config.defaultTaxRateBps,
  exchangeRate = config.exchangeRateScale,
  region = config.defaultRegion,
  recipientEmail?: string,
  notes?: string
): Invoice => {
  const lineItems: InvoiceLineItem[] = [];

  // Base subscription line item
  const baseLineItem = buildInvoiceLineItem(subscription, config, exchangeRate, taxRateBps);
  lineItems.push(baseLineItem);

  // Add proration line item if applicable
  if (prorationPreview && prorationPreview.amount > 0) {
    const prorationLineItem = buildProrationLineItem(prorationPreview, config.defaultCurrency);
    lineItems.push(prorationLineItem);
  }

  const totals = calculateInvoiceTotals(lineItems, taxRateBps);
  const createdAt = new Date();
  const dueDate = new Date(period.end.getTime() + config.paymentTermsDays * DAY);

  return {
    id: `${subscription.id}-${sequence}`,
    invoiceNumber: formatInvoiceNumber(sequence, config),
    subscriptionId: subscription.id,
    subscriptionName: subscription.name,
    merchantName: subscription.description ?? subscription.name,
    lineItems,
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
    notes: notes ?? prorationPreview?.description,
  };
};

/** Generates clean, printable HTML representation of an invoice with print styles (issue #1277). */
export const generatePrintableInvoiceHtml = (invoice: Invoice): string => {
  const lineItemsHtml = invoice.lineItems
    .map(
      (item) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${item.description}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(item.unitPrice, item.currency)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatCurrency(item.lineTotal, item.currency)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; color: #1a1a1a; background: #fff; }
    .invoice-card { max-width: 800px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; border-bottom: 2px solid #6366f1; padding-bottom: 16px; }
    .logo-title { font-size: 24px; font-weight: 800; color: #6366f1; margin: 0; }
    .invoice-num { font-size: 18px; font-weight: 600; color: #374151; margin-top: 4px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
    .meta-block h4 { margin: 0 0 6px 0; font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; }
    .meta-block p { margin: 0; font-size: 14px; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
    th { background: #f9fafb; padding: 12px 10px; text-align: left; font-size: 12px; font-weight: 600; color: #4b5563; text-transform: uppercase; border-bottom: 2px solid #e5e7eb; }
    .totals { width: 300px; margin-left: auto; margin-bottom: 24px; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
    .totals-row.grand { font-size: 18px; font-weight: 700; border-top: 2px solid #1a1a1a; padding-top: 12px; margin-top: 6px; }
    .notes { margin-top: 24px; padding: 16px; background: #f9fafb; border-radius: 6px; font-size: 13px; color: #4b5563; }
    @media print {
      body { padding: 0; background: none; }
      .invoice-card { border: none; box-shadow: none; padding: 0; }
      @page { margin: 1.5cm; }
    }
  </style>
</head>
<body>
  <div class="invoice-card">
    <div class="header">
      <div>
        <h1 class="logo-title">SubTrackr</h1>
        <div class="invoice-num">INVOICE: ${invoice.invoiceNumber}</div>
      </div>
      <div style="text-align: right;">
        <span style="display: inline-block; padding: 4px 12px; border-radius: 9999px; background: #e0e7ff; color: #3730a3; font-weight: 600; font-size: 12px; text-transform: uppercase;">
          ${invoice.status}
        </span>
      </div>
    </div>
    <div class="meta-grid">
      <div class="meta-block">
        <h4>Merchant / Provider</h4>
        <p>${invoice.merchantName}</p>
        <p style="color: #6b7280; font-size: 13px;">${invoice.subscriptionName}</p>
      </div>
      <div class="meta-block" style="text-align: right;">
        <h4>Invoice Details</h4>
        <p><strong>Created:</strong> ${formatDate(invoice.createdAt)}</p>
        <p><strong>Due Date:</strong> ${formatDate(invoice.dueDate)}</p>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align: center;">Qty</th>
          <th style="text-align: right;">Unit Price</th>
          <th style="text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemsHtml}
      </tbody>
    </table>
    <div class="totals">
      <div class="totals-row"><span>Subtotal:</span><span>${formatCurrency(invoice.subtotal, invoice.currency)}</span></div>
      <div class="totals-row"><span>Tax:</span><span>${formatCurrency(invoice.tax, invoice.currency)}</span></div>
      <div class="totals-row grand"><span>Total Due:</span><span>${formatCurrency(invoice.total, invoice.currency)}</span></div>
    </div>
    ${invoice.notes ? `<div class="notes"><strong>Notes:</strong> ${invoice.notes}</div>` : ''}
  </div>
</body>
</html>`;
};

