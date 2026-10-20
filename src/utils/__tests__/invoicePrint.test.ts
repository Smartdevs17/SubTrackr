import {
  generatePrintableInvoiceHtml,
  buildInvoice,
  buildBillingPeriod,
  validateInvoiceLineItemMetadata,
} from '../invoice';
import {
  Subscription,
  BillingCycle,
  SubscriptionStatus,
  SubscriptionCategory,
} from '../../types/subscription';

const mockSubscription: Subscription = {
  id: 'sub-101',
  name: 'Pro Cloud Hosting',
  description: 'Enterprise Tier',
  price: 2999,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  nextBillingDate: new Date('2026-10-01T00:00:00.000Z'),
  category: SubscriptionCategory.SOFTWARE,
  isActive: true,
  isCryptoEnabled: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('Printable Invoice Utility (Issue #1277)', () => {
  it('generates valid printable HTML string with invoice details and print styles', () => {
    const period = buildBillingPeriod(mockSubscription);
    const invoice = buildInvoice(mockSubscription, 1, period);
    const html = generatePrintableInvoiceHtml(invoice);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('SubTrackr');
    expect(html).toContain(invoice.invoiceNumber);
    expect(html).toContain(mockSubscription.name);
    expect(html).toContain('@media print');
    expect(html).toContain('Total Due:');
  });

  it('includes invoice notes in generated HTML when provided', () => {
    const period = buildBillingPeriod(mockSubscription);
    const invoice = buildInvoice(
      mockSubscription,
      2,
      period,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'Special corporate rate applied'
    );
    const html = generatePrintableInvoiceHtml(invoice);

    expect(html).toContain('Notes:');
    expect(html).toContain('Special corporate rate applied');
  });

  it('renders line-item metadata in the printable invoice', () => {
    const period = buildBillingPeriod(mockSubscription);
    const invoice = buildInvoice(mockSubscription, 3, period);
    invoice.lineItems[0].metadata = { reference: 'PO-123', source: 'migration' };

    const html = generatePrintableInvoiceHtml(invoice);

    expect(html).toContain('reference:');
    expect(html).toContain('PO-123');
    expect(html).toContain('source:');
  });

  it('validates metadata as bounded string key/value pairs', () => {
    expect(validateInvoiceLineItemMetadata({ reference: 'PO-123' })).toEqual([]);
    expect(validateInvoiceLineItemMetadata({ reference: 123 })).toContain(
      'line item metadata.reference must be a string'
    );
    expect(validateInvoiceLineItemMetadata(null)).toEqual([
      'line item metadata must be an object of string key/value pairs',
    ]);
  });
});
