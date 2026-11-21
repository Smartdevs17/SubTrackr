/**
 * Consolidated monthly invoicing (issue #1733).
 *
 * Merchants opt in per merchant id. Opted-out merchants keep one invoice per
 * charge; opted-in merchants get one invoice for the cycle with every charge
 * preserved as a line item.
 */

import { ConsolidationEngine } from '../consolidationEngine';
import { DEFAULT_INVOICE_CONFIG, type InvoiceConfig } from '../../../../src/types/invoice';
import {
  BillingCycle,
  SubscriptionCategory,
  type Subscription,
} from '../../../../src/types/subscription';

const PERIOD = {
  start: new Date('2026-04-01T00:00:00.000Z'),
  end: new Date('2026-05-01T00:00:00.000Z'),
};

const CONFIG: InvoiceConfig = {
  ...DEFAULT_INVOICE_CONFIG,
  defaultCurrency: 'USD',
  defaultTaxRateBps: 0,
};

function makeSubscription(
  id: string,
  overrides: Partial<Subscription> = {}
): Subscription {
  return {
    id,
    name: `Plan ${id}`,
    category: SubscriptionCategory.SOFTWARE,
    price: 10,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date('2026-05-01T00:00:00.000Z'),
    isActive: true,
    isCryptoEnabled: false,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ConsolidationEngine monthly invoices', () => {
  let engine: ConsolidationEngine;

  beforeEach(() => {
    engine = new ConsolidationEngine();
  });

  it('is opt-out by default', () => {
    expect(engine.isMerchantConsolidationEnabled('merchant-1')).toBe(false);
    expect(engine.getMerchantConsolidation('merchant-1')).toBeUndefined();
  });

  it('tracks the opt-in independently per merchant', () => {
    engine.setMerchantConsolidation('merchant-1', true);

    expect(engine.isMerchantConsolidationEnabled('merchant-1')).toBe(true);
    expect(engine.isMerchantConsolidationEnabled('merchant-2')).toBe(false);
    expect(engine.getMerchantConsolidation('merchant-1')).toMatchObject({
      merchantId: 'merchant-1',
      enabled: true,
    });
  });

  it('keeps one invoice per charge when the merchant is opted out', () => {
    const invoices = engine.generateCycleInvoices({
      merchantId: 'merchant-1',
      sequence: 7,
      period: PERIOD,
      config: CONFIG,
      subscriptions: [
        makeSubscription('a', { price: 10 }),
        makeSubscription('b', { price: 20 }),
        makeSubscription('free', { price: 0 }),
        makeSubscription('inactive', { price: 30, isActive: false }),
      ],
    });

    expect(invoices).toHaveLength(2);
    expect(invoices.map((invoice) => invoice.invoiceNumber)).toEqual([
      'INV-000007',
      'INV-000008',
    ]);
    expect(invoices[0].lineItems).toHaveLength(1);
    expect(invoices[0].lineItems[0].description).toBe('Plan a');
    expect(invoices[1].lineItems[0].description).toBe('Plan b');
    expect(invoices[0].total).toBe(10);
    expect(invoices[1].total).toBe(20);
  });

  it('consolidates a cycle into one invoice and preserves every line item', () => {
    engine.setMerchantConsolidation('merchant-1', true);

    const invoices = engine.generateCycleInvoices({
      merchantId: 'merchant-1',
      sequence: 7,
      period: PERIOD,
      config: CONFIG,
      subscriptions: [
        makeSubscription('a', { price: 10 }),
        makeSubscription('b', { price: 20 }),
        makeSubscription('c', { price: 30 }),
        makeSubscription('free', { price: 0 }),
        makeSubscription('inactive', { price: 40, isActive: false }),
      ],
    });

    expect(invoices).toHaveLength(1);
    const invoice = invoices[0];
    expect(invoice.invoiceNumber).toBe('INV-000007');
    expect(invoice.subscriptionId).toBe('a,b,c');
    expect(invoice.lineItems).toHaveLength(3);
    expect(invoice.lineItems.map((item) => item.description)).toEqual([
      'Plan a',
      'Plan b',
      'Plan c',
    ]);
    expect(invoice.subtotal).toBe(60);
    expect(invoice.total).toBe(60);
  });

  it('does not consolidate when only one subscription is billable', () => {
    engine.setMerchantConsolidation('merchant-1', true);

    const invoices = engine.generateCycleInvoices({
      merchantId: 'merchant-1',
      sequence: 1,
      period: PERIOD,
      config: CONFIG,
      subscriptions: [
        makeSubscription('only', { price: 25 }),
        makeSubscription('free', { price: 0 }),
      ],
    });

    expect(invoices).toHaveLength(1);
    expect(invoices[0].lineItems).toHaveLength(1);
    expect(invoices[0].lineItems[0].description).toBe('Plan only');
    expect(invoices[0].subscriptionName).not.toContain('Consolidated');
  });

  it('returns no invoices when nothing is billable', () => {
    engine.setMerchantConsolidation('merchant-1', true);

    expect(
      engine.generateCycleInvoices({
        merchantId: 'merchant-1',
        sequence: 1,
        period: PERIOD,
        config: CONFIG,
        subscriptions: [
          makeSubscription('free', { price: 0 }),
          makeSubscription('inactive', { isActive: false }),
        ],
      })
    ).toEqual([]);
  });

  it('can clear a merchant setting', () => {
    engine.setMerchantConsolidation('merchant-1', true);
    expect(engine.clearMerchantConsolidation('merchant-1')).toBe(true);
    expect(engine.isMerchantConsolidationEnabled('merchant-1')).toBe(false);
  });

  it('rejects an empty merchant id', () => {
    expect(() => engine.setMerchantConsolidation('', true)).toThrow(
      'merchantId is required'
    );
  });
});
