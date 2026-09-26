import { generatePrintableInvoiceHtml, buildInvoice, buildBillingPeriod } from '../invoice';
import { Subscription, BillingCycle, SubscriptionStatus, SubscriptionCategory } from '../../types/subscription';

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
    const invoice = buildInvoice(mockSubscription, 2, period, undefined, undefined, undefined, undefined, undefined, 'Special corporate rate applied');
    const html = generatePrintableInvoiceHtml(invoice);

    expect(html).toContain('Notes:');
    expect(html).toContain('Special corporate rate applied');
  });
});
