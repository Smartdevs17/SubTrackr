import { TaxService } from '../taxService';
import type {
  TaxJurisdiction,
  TaxRateEntry,
  CustomerTaxStatus,
  TaxRemittanceLineItem,
  TaxRemittanceReportRequest,
  TaxInvoiceContext,
  MidCycleTaxChange,
} from '../taxTypes';

const makeJurisdiction = (overrides: Partial<TaxJurisdiction> = {}): TaxJurisdiction => ({
  country: '',
  state: '',
  city: '',
  ...overrides,
});

describe('TaxService', () => {
  beforeEach(() => {
    TaxService.invalidateTaxRateCache();
  });

  // ── Tax rate lookup by jurisdiction ─────────────────────────────────────

  it('looks up VAT rate for EU country', () => {
    const entry = TaxService.getTaxRate(makeJurisdiction({ country: 'DE' }));
    expect(entry).not.toBeNull();
    expect(entry!.taxType).toBe('vat');
    expect(entry!.rateBps).toBe(1900);
  });

  it('looks up GST rate for Australia', () => {
    const entry = TaxService.getTaxRate(makeJurisdiction({ country: 'AU' }));
    expect(entry).not.toBeNull();
    expect(entry!.taxType).toBe('gst');
    expect(entry!.rateBps).toBe(1000);
  });

  it('looks up US state sales tax for NY', () => {
    const entry = TaxService.getTaxRate(makeJurisdiction({ country: 'US', state: 'NY' }));
    expect(entry).not.toBeNull();
    expect(entry!.jurisdictionKey).toBe('US-NY');
    expect(entry!.taxType).toBe('sales_tax');
    expect(entry!.rateBps).toBe(887);
  });

  it('looks up US state sales tax for CA', () => {
    const entry = TaxService.getTaxRate(makeJurisdiction({ country: 'US', state: 'CA' }));
    expect(entry!.rateBps).toBe(850);
  });

  it('returns null for unknown country', () => {
    const entry = TaxService.getTaxRate(makeJurisdiction({ country: 'XX' }));
    expect(entry).toBeNull();
  });

  it('looks up tax with city level detail and falls back to state', () => {
    const entry = TaxService.getTaxRate(
      makeJurisdiction({ country: 'US', state: 'NY', city: 'NYC' })
    );
    expect(entry).not.toBeNull();
    expect(entry!.jurisdictionKey).toBe('US-NY-NYC');
  });

  // ── Digital goods taxability ────────────────────────────────────────────

  it('standard digital goods are taxable in DE', () => {
    const taxable = TaxService.isDigitalGoodsTaxable('standard', 'DE');
    expect(taxable).toBe(true);
  });

  it('educational exempt goods are not taxable in US', () => {
    const taxable = TaxService.isDigitalGoodsTaxable('exempt', 'US');
    expect(taxable).toBe(false);
  });

  it('electronic services are taxable in CA', () => {
    const taxable = TaxService.isDigitalGoodsTaxable('electronic_service', 'CA');
    expect(taxable).toBe(true);
  });

  it('returns rules for a specific classification', () => {
    const rules = TaxService.getDigitalGoodsRules('standard');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.classification === 'standard')).toBe(true);
  });

  // ── Tax exemption handling ──────────────────────────────────────────────

  it('validates a valid exemption certificate', () => {
    const status: CustomerTaxStatus = {
      isExempt: true,
      certificateId: 'CERT-DE-001',
      certificateExpiry: 0,
      issuingAuthority: 'Finanzamt Berlin',
      exemptJurisdictions: [],
    };
    expect(TaxService.validateTaxCertificate(status, 'CERT-DE-001')).toBe(true);
  });

  it('rejects expired exemption certificate', () => {
    const status: CustomerTaxStatus = {
      isExempt: true,
      certificateId: 'CERT-EXPIRED',
      certificateExpiry: 1000000,
      issuingAuthority: 'Authority',
      exemptJurisdictions: [],
    };
    expect(TaxService.validateTaxCertificate(status, 'CERT-EXPIRED')).toBe(false);
  });

  it('rejects mismatched certificate ID', () => {
    const status: CustomerTaxStatus = {
      isExempt: true,
      certificateId: 'CERT-REAL',
      certificateExpiry: 0,
      issuingAuthority: 'Authority',
      exemptJurisdictions: [],
    };
    expect(TaxService.validateTaxCertificate(status, 'CERT-FAKE')).toBe(false);
  });

  it('isCustomerTaxExempt returns true for valid exemption', () => {
    const status: CustomerTaxStatus = {
      isExempt: true,
      certificateId: 'CERT-1',
      certificateExpiry: 0,
      issuingAuthority: 'Authority',
      exemptJurisdictions: [],
    };
    expect(TaxService.isCustomerTaxExempt(status, 'DE')).toBe(true);
  });

  it('isCustomerTaxExempt restricts to specific jurisdictions', () => {
    const status: CustomerTaxStatus = {
      isExempt: true,
      certificateId: 'CERT-DE-ONLY',
      certificateExpiry: 0,
      issuingAuthority: 'Authority',
      exemptJurisdictions: ['DE'],
    };
    expect(TaxService.isCustomerTaxExempt(status, 'DE')).toBe(true);
    expect(TaxService.isCustomerTaxExempt(status, 'FR')).toBe(false);
  });

  // ── Tax calculation ─────────────────────────────────────────────────────

  it('calculates VAT on taxable amount', () => {
    const context: TaxInvoiceContext = {
      subscriptionId: 'sub-1',
      planId: 'plan-1',
      merchantId: 'merchant-1',
      subscriberId: 'cust-1',
      jurisdiction: makeJurisdiction({ country: 'DE' }),
      subtotal: 10000,
      currency: 'EUR',
      periodStart: Date.now() - 30 * 86400000,
      periodEnd: Date.now(),
      digitalGoodsClass: 'standard',
    };
    const result = TaxService.calculateTax(context);
    expect(result.taxAmount).toBe(1900);
    expect(result.taxRateBps).toBe(1900);
    expect(result.taxType).toBe('vat');
    expect(result.isExempt).toBe(false);
  });

  it('calculates zero tax for unknown jurisdiction', () => {
    const context: TaxInvoiceContext = {
      subscriptionId: 'sub-1',
      planId: 'plan-1',
      merchantId: 'merchant-1',
      subscriberId: 'cust-1',
      jurisdiction: makeJurisdiction({ country: 'XX' }),
      subtotal: 10000,
      currency: 'EUR',
      periodStart: Date.now() - 30 * 86400000,
      periodEnd: Date.now(),
      digitalGoodsClass: 'standard',
    };
    const result = TaxService.calculateTax(context);
    expect(result.taxAmount).toBe(0);
    expect(result.taxType).toBe('none');
  });

  it('calculates US sales tax correctly', () => {
    const context: TaxInvoiceContext = {
      subscriptionId: 'sub-1',
      planId: 'plan-1',
      merchantId: 'merchant-1',
      subscriberId: 'cust-1',
      jurisdiction: makeJurisdiction({ country: 'US', state: 'CA' }),
      subtotal: 10000,
      currency: 'USD',
      periodStart: Date.now() - 30 * 86400000,
      periodEnd: Date.now(),
      digitalGoodsClass: 'standard',
    };
    const result = TaxService.calculateTax(context);
    expect(result.taxRateBps).toBe(850);
  });

  // ── Tax calculation with exemption ──────────────────────────────────────

  it('calculateTaxWithExemption applies exemption', () => {
    const context: TaxInvoiceContext = {
      subscriptionId: 'sub-1',
      planId: 'plan-1',
      merchantId: 'merchant-1',
      subscriberId: 'cust-1',
      jurisdiction: makeJurisdiction({ country: 'DE' }),
      subtotal: 10000,
      currency: 'EUR',
      periodStart: Date.now() - 30 * 86400000,
      periodEnd: Date.now(),
      digitalGoodsClass: 'standard',
    };
    const status: CustomerTaxStatus = {
      isExempt: true,
      certificateId: 'CERT-1',
      certificateExpiry: 0,
      issuingAuthority: 'Auth',
      exemptJurisdictions: [],
    };
    const result = TaxService.calculateTaxWithExemption(context, status);
    expect(result.taxAmount).toBe(0);
    expect(result.isExempt).toBe(true);
  });

  it('calculateTaxWithExemption ignores null status', () => {
    const context: TaxInvoiceContext = {
      subscriptionId: 'sub-1',
      planId: 'plan-1',
      merchantId: 'merchant-1',
      subscriberId: 'cust-1',
      jurisdiction: makeJurisdiction({ country: 'DE' }),
      subtotal: 10000,
      currency: 'EUR',
      periodStart: Date.now() - 30 * 86400000,
      periodEnd: Date.now(),
      digitalGoodsClass: 'standard',
    };
    const result = TaxService.calculateTaxWithExemption(context, null);
    expect(result.taxAmount).toBe(1900);
    expect(result.isExempt).toBe(false);
  });

  // ── Mid-cycle tax rate change (proration) ───────────────────────────────

  it('prorates tax across a mid-cycle rate change', () => {
    const now = Date.now();
    const periodStart = now - 31 * 86400000;
    const periodEnd = now;
    const changeDate = now - 15 * 86400000;

    const results = TaxService.calculateMidCycleTaxChange(
      periodStart,
      periodEnd,
      310000,
      'DE',
      [
        {
          jurisdictionKey: 'DE',
          oldRateBps: 1900,
          newRateBps: 1600,
          changedAt: changeDate,
          effectiveFrom: changeDate,
        },
      ]
    );

    expect(results.length).toBeGreaterThan(0);
    const totalTax = results.reduce((s, r) => s + r.totalTax, 0);
    expect(totalTax).toBeGreaterThan(0);
  });

  it('handles rate change after billing period', () => {
    const now = Date.now();
    const periodStart = now - 15 * 86400000;
    const periodEnd = now;
    const changeDate = now + 5 * 86400000;

    const results = TaxService.calculateMidCycleTaxChange(
      periodStart,
      periodEnd,
      10000,
      'DE',
      [
        {
          jurisdictionKey: 'DE',
          oldRateBps: 1900,
          newRateBps: 1600,
          changedAt: changeDate,
          effectiveFrom: changeDate,
        },
      ]
    );

    expect(results.length).toBe(0);
  });

  // ── Tax remittance report ────────────────────────────────────────────────

  it('generates a remittance report for a jurisdiction', () => {
    const lines: TaxRemittanceLineItem[] = [
      {
        jurisdictionKey: 'DE',
        taxType: 'vat',
        taxableAmount: 10000,
        rateBps: 1900,
        taxCollected: 1900,
        transactionCount: 1,
        currency: 'EUR',
      },
      {
        jurisdictionKey: 'DE',
        taxType: 'vat',
        taxableAmount: 20000,
        rateBps: 1900,
        taxCollected: 3800,
        transactionCount: 1,
        currency: 'EUR',
      },
    ];

    const report = TaxService.generateTaxRemittanceReport(lines, {
      merchantId: 'merchant-1',
      periodStart: Date.now() - 30 * 86400000,
      periodEnd: Date.now(),
      format: 'summary',
    });

    expect(report.totalTaxableAmount).toBe(30000);
    expect(report.totalTaxCollected).toBe(5700);
    expect(report.lineItems.length).toBe(1);
  });

  it('aggregates by jurisdiction and tax type', () => {
    const lines: TaxRemittanceLineItem[] = [
      {
        jurisdictionKey: 'DE',
        taxType: 'vat',
        taxableAmount: 10000,
        rateBps: 1900,
        taxCollected: 1900,
        transactionCount: 1,
        currency: 'EUR',
      },
      {
        jurisdictionKey: 'AU',
        taxType: 'gst',
        taxableAmount: 15000,
        rateBps: 1000,
        taxCollected: 1500,
        transactionCount: 1,
        currency: 'AUD',
      },
    ];

    const report = TaxService.generateTaxRemittanceReport(lines, {
      merchantId: 'merchant-1',
      periodStart: Date.now() - 30 * 86400000,
      periodEnd: Date.now(),
      format: 'summary',
    });

    expect(report.lineItems.length).toBe(2);
    expect(report.totalTaxCollected).toBe(3400);
  });

  it('filters by jurisdictions', () => {
    const lines: TaxRemittanceLineItem[] = [
      {
        jurisdictionKey: 'DE',
        taxType: 'vat',
        taxableAmount: 10000,
        rateBps: 1900,
        taxCollected: 1900,
        transactionCount: 1,
        currency: 'EUR',
      },
      {
        jurisdictionKey: 'AU',
        taxType: 'gst',
        taxableAmount: 15000,
        rateBps: 1000,
        taxCollected: 1500,
        transactionCount: 1,
        currency: 'AUD',
      },
    ];

    const report = TaxService.generateTaxRemittanceReport(lines, {
      merchantId: 'merchant-1',
      periodStart: Date.now() - 30 * 86400000,
      periodEnd: Date.now(),
      format: 'summary',
      jurisdictions: ['DE'],
    });

    expect(report.lineItems.length).toBe(1);
    expect(report.totalTaxCollected).toBe(1900);
  });

  // ── Nexus determination ──────────────────────────────────────────────────

  it('determines nexus when revenue exceeds threshold', () => {
    const nexus = TaxService.checkNexus('merchant-1', makeJurisdiction({ country: 'DE' }), 10000000);
    expect(nexus.isEstablished).toBe(true);
  });

  it('determines no nexus when below threshold', () => {
    const nexus = TaxService.checkNexus('merchant-1', makeJurisdiction({ country: 'DE' }), 100);
    expect(nexus.isEstablished).toBe(false);
  });

  it('determines no nexus for unknown jurisdiction', () => {
    const nexus = TaxService.checkNexus(
      'merchant-1',
      makeJurisdiction({ country: 'XX' }),
      50000000
    );
    expect(nexus.isEstablished).toBe(false);
  });

  // ── Tax rate by key ──────────────────────────────────────────────────────

  it('gets tax rate entry by jurisdiction key', () => {
    const entry = TaxService.getTaxRateByKey('US-CA');
    expect(entry).not.toBeNull();
    expect(entry!.rateBps).toBe(850);
  });

  it('returns null for unknown key', () => {
    expect(TaxService.getTaxRateByKey('XX-YY')).toBeNull();
  });

  // ── Supported jurisdictions ──────────────────────────────────────────────

  it('lists all supported jurisdictions', () => {
    const jurisdictions = TaxService.getSupportedJurisdictions();
    expect(jurisdictions).toContain('DE');
    expect(jurisdictions).toContain('AU');
    expect(jurisdictions).toContain('US-CA');
  });

  // ── Group by jurisdiction ────────────────────────────────────────────────

  it('groups tax lines by jurisdiction', () => {
    const lines: TaxRemittanceLineItem[] = [
      {
        jurisdictionKey: 'DE',
        taxType: 'vat',
        taxableAmount: 10000,
        rateBps: 1900,
        taxCollected: 1900,
        transactionCount: 1,
        currency: 'EUR',
      },
      {
        jurisdictionKey: 'DE',
        taxType: 'vat',
        taxableAmount: 5000,
        rateBps: 1900,
        taxCollected: 950,
        transactionCount: 1,
        currency: 'EUR',
      },
      {
        jurisdictionKey: 'AU',
        taxType: 'gst',
        taxableAmount: 10000,
        rateBps: 1000,
        taxCollected: 1000,
        transactionCount: 1,
        currency: 'AUD',
      },
    ];

    const groups = TaxService.groupByJurisdiction(lines);
    expect(Object.keys(groups)).toHaveLength(2);
    expect(groups['DE'].totalTax).toBe(2850);
    expect(groups['AU'].totalTax).toBe(1000);
  });

  // ── Total tax revenue ────────────────────────────────────────────────────

  it('calculates total tax revenue', () => {
    const lines: TaxRemittanceLineItem[] = [
      {
        jurisdictionKey: 'DE',
        taxType: 'vat',
        taxableAmount: 10000,
        rateBps: 1900,
        taxCollected: 1900,
        transactionCount: 1,
        currency: 'EUR',
      },
      {
        jurisdictionKey: 'GB',
        taxType: 'vat',
        taxableAmount: 20000,
        rateBps: 2000,
        taxCollected: 4000,
        transactionCount: 1,
        currency: 'GBP',
      },
    ];

    expect(TaxService.calculateTotalTaxRevenue(lines)).toBe(5900);
  });

  // ── Cache management ─────────────────────────────────────────────────────

  it('cache returns stored tax rate', () => {
    const jurisdiction = makeJurisdiction({ country: 'DE' });
    const entry1 = TaxService.getTaxRate(jurisdiction);
    const entry2 = TaxService.getTaxRate(jurisdiction);
    expect(entry1).toEqual(entry2);
  });

  it('invalidate clears cache', () => {
    TaxService.getTaxRate(makeJurisdiction({ country: 'DE' }));
    TaxService.invalidateTaxRateCache();
    const entry = TaxService.getTaxRate(makeJurisdiction({ country: 'DE' }));
    expect(entry).not.toBeNull();
  });
});
