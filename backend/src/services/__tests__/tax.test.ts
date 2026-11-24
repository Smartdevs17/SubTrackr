/**
 * backend/src/services/__tests__/tax.test.ts
 *
 * Unit tests for the backend TaxPolicyService adapter.
 */

import { TaxPolicyService, toLegacyTaxCalculation } from '../tax';
import { TaxPolicyError } from '../../../packages/tax-policies/index.ts';

import type { TaxJurisdiction, DigitalGoodsClass, TaxPolicy } from '../../../packages/tax-policies/index.ts';

const makeJurisdiction = (overrides: Partial<TaxJurisdiction> = {}): TaxJurisdiction => ({
  country: '',
  state: '',
  city: '',
  ...overrides,
});

describe('backend/src/services/tax.ts - TaxPolicyService', () => {
  // ── Happy path calculations ───────────────────────────────────────────────

  it('calculates DE VAT on 100.00 EUR', () => {
    const svc = new TaxPolicyService();
    const result = svc.calculate({
      subtotalMinor: 10_000,
      currency: 'EUR',
      jurisdiction: makeJurisdiction({ country: 'DE' }),
    });

    expect(result.status).toBe('matched');
    expect(result.taxAmountMinor).toBe(1_900); // 100.00 * 19%
    expect(result.rateBps).toBe(1900);
    expect(result.taxType).toBe('vat');
    expect(result.currency).toBe('EUR');
    expect(result.isExempt).toBe(false);
    expect(result.isReverseCharge).toBe(false);
  });

  it('calculates US-CA sales tax on 50.00 USD', () => {
    const svc = new TaxPolicyService();
    const result = svc.calculate({
      subtotalMinor: 5_000,
      currency: 'USD',
      jurisdiction: makeJurisdiction({ country: 'US', state: 'CA' }),
    });

    expect(result.taxAmountMinor).toBe(425); // 50.00 * 8.5%
    expect(result.rateBps).toBe(850);
    expect(result.taxType).toBe('sales_tax');
  });

  it('falls back US state -> country', () => {
    const svc = new TaxPolicyService();
    const result = svc.calculate({
      subtotalMinor: 10_000,
      currency: 'USD',
      jurisdiction: makeJurisdiction({ country: 'US', state: 'ZZ' }),
    });

    expect(result.status).toBe('matched');
    expect(result.rateBps).toBe(0); // US federal = 0
    expect(result.taxAmountMinor).toBe(0);
  });

  it('applies digital goods reduced rate for DE e-books', () => {
    const svc = new TaxPolicyService();
    const result = svc.calculate({
      subtotalMinor: 10_000,
      currency: 'EUR',
      jurisdiction: makeJurisdiction({ country: 'DE' }),
      digitalGoodsClass: 'reduced_rate',
    });

    expect(result.rateBps).toBe(700);
    expect(result.taxAmountMinor).toBe(700);
  });

  it('exempts US educational materials', () => {
    const svc = new TaxPolicyService();
    const result = svc.calculate({
      subtotalMinor: 10_000,
      currency: 'USD',
      jurisdiction: makeJurisdiction({ country: 'US' }),
      digitalGoodsClass: 'exempt',
    });

    expect(result.rateBps).toBe(0);
    expect(result.taxAmountMinor).toBe(0);
    expect(result.taxType).toBe('none');
  });

  it('respects customer exemption certificate', () => {
    const svc = new TaxPolicyService();
    const result = svc.calculate({
      subtotalMinor: 10_000,
      currency: 'EUR',
      jurisdiction: makeJurisdiction({ country: 'DE' }),
      exempt: true,
    });

    expect(result.isExempt).toBe(true);
    expect(result.taxAmountMinor).toBe(0);
  });

  it('applies reverse charge from policy (none in built-ins)', () => {
    const policy: TaxPolicy = {
      jurisdictionKey: 'IE',
      taxType: 'vat',
      rateBps: 2300,
      displayName: 'Irish VAT',
      effectiveFrom: 0,
      effectiveUntil: 0,
      appliesToDigitalGoods: true,
      reverseCharge: true, // B2B cross-border
      nexusThreshold: 0,
    };
    const svc = new TaxPolicyService({ policies: [policy] });
    const result = svc.calculate({
      subtotalMinor: 10_000,
      currency: 'EUR',
      jurisdiction: makeJurisdiction({ country: 'IE' }),
    });

    expect(result.isReverseCharge).toBe(true);
    expect(result.taxAmountMinor).toBe(0);
  });

  it('allows explicit reverse charge flag to override', () => {
    const svc = new TaxPolicyService();
    const result = svc.calculate({
      subtotalMinor: 10_000,
      currency: 'EUR',
      jurisdiction: makeJurisdiction({ country: 'DE' }),
      reverseCharge: true,
    });

    expect(result.isReverseCharge).toBe(true);
    expect(result.taxAmountMinor).toBe(0);
  });

  // ── Rejection cases ───────────────────────────────────────────────────────

  it('rejects invalid region', () => {
    const svc = new TaxPolicyService();
    expect(() =>
      svc.calculate({
        subtotalMinor: 1000,
        currency: 'EUR',
        jurisdiction: makeJurisdiction({ country: 'XX' }),
      })
    ).toThrow(TaxPolicyError);
  });

  it('rejects negative amount', () => {
    const svc = new TaxPolicyService();
    expect(() =>
      svc.calculate({
        subtotalMinor: -1,
        currency: 'EUR',
        jurisdiction: makeJurisdiction({ country: 'DE' }),
      })
    ).toThrow(TaxPolicyError);
  });

  it('rejects fractional amount', () => {
    const svc = new TaxPolicyService();
    expect(() =>
      svc.calculate({
        subtotalMinor: 100.5,
        currency: 'EUR',
        jurisdiction: makeJurisdiction({ country: 'DE' }),
      })
    ).toThrow(TaxPolicyError);
  });

  it('rejects too-large amount', () => {
    const svc = new TaxPolicyService();
    expect(() =>
      svc.calculate({
        subtotalMinor: 1_000_000_000_001,
        currency: 'EUR',
        jurisdiction: makeJurisdiction({ country: 'DE' }),
      })
    ).toThrow(TaxPolicyError);
  });

  it('rejects unknown currency', () => {
    const svc = new TaxPolicyService();
    expect(() =>
      svc.calculate({
        subtotalMinor: 10_000,
        currency: 'XXX',
        jurisdiction: makeJurisdiction({ country: 'DE' }),
      })
    ).toThrow(TaxPolicyError);
  });

  it('rejects unsupported currency for policy with currency restriction', () => {
    const policy: TaxPolicy = {
      jurisdictionKey: 'DE',
      taxType: 'vat',
      rateBps: 1900,
      displayName: 'DE',
      effectiveFrom: 0,
      effectiveUntil: 0,
      appliesToDigitalGoods: true,
      reverseCharge: false,
      nexusThreshold: 0,
      currencies: ['EUR'],
    };
    const svc = new TaxPolicyService({ policies: [policy] });
    expect(() =>
      svc.calculate({
        subtotalMinor: 10_000,
        currency: 'USD',
        jurisdiction: makeJurisdiction({ country: 'DE' }),
      })
    ).toThrow(TaxPolicyError);
  });

  // ── Region overrides ──────────────────────────────────────────────────────

  it('configures runtime region override', () => {
    const svc = new TaxPolicyService();
    svc.configureRegion({ region: 'DE', rateBps: 1600 });
    const result = svc.calculate({
      subtotalMinor: 10_000,
      currency: 'EUR',
      jurisdiction: makeJurisdiction({ country: 'DE' }),
    });
    expect(result.rateBps).toBe(1600);
  });

  it('returns configured override', () => {
    const svc = new TaxPolicyService();
    svc.configureRegion({ region: 'DE', rateBps: 1600 });
    const policy = svc.getRegionPolicy('DE');
    expect(policy?.rateBps).toBe(1600);
  });

  it('clears single override', () => {
    const svc = new TaxPolicyService();
    svc.configureRegion({ region: 'DE', rateBps: 1600 });
    expect(svc.clearRegion('DE')).toBe(true);
    const result = svc.calculate({
      subtotalMinor: 10_000,
      currency: 'EUR',
      jurisdiction: makeJurisdiction({ country: 'DE' }),
    });
    expect(result.rateBps).toBe(1900);
  });

  it('clears all overrides', () => {
    const svc = new TaxPolicyService();
    svc.configureRegion({ region: 'DE', rateBps: 1600 });
    svc.configureRegion({ region: 'US-CA', rateBps: 900 });
    svc.clearRegions();
    const de = svc.calculate({
      subtotalMinor: 10_000,
      currency: 'EUR',
      jurisdiction: makeJurisdiction({ country: 'DE' }),
    });
    const ca = svc.calculate({
      subtotalMinor: 10_000,
      currency: 'USD',
      jurisdiction: makeJurisdiction({ country: 'US', state: 'CA' }),
    });
    expect(de.rateBps).toBe(1900);
    expect(ca.rateBps).toBe(850);
  });

  // ── Proration ─────────────────────────────────────────────────────────────

  it('prorates across mid-cycle rate change', () => {
    const svc = new TaxPolicyService();
    const periodStart = 1_000_000_000_000;
    const periodEnd = 1_000_000_008_640_000; // 10 days
    const segments = svc.prorate({
      periodStart,
      periodEnd,
      taxableAmountMinor: 1_000_000,
      baseRateBps: 1000,
      changes: [{ effectiveFrom: periodStart + 4_320_000_000, newRateBps: 2000 }], // day 5
    });

    expect(segments.length).toBe(2);
    expect(segments[0].rateBps).toBe(1000);
    expect(segments[1].rateBps).toBe(2000);
    const totalTax = segments.reduce((s, seg) => s + seg.taxAmountMinor, 0);
    // 5 days at 10% + 5 days at 20% = 5000 + 10000 = 15000
    expect(totalTax).toBe(15_000);
  });

  // ── Digital goods ─────────────────────────────────────────────────────────

  it('delegates digital goods taxability check', () => {
    const svc = new TaxPolicyService();
    expect(svc.isDigitalGoodsTaxable('exempt', 'US')).toBe(false);
    expect(svc.isDigitalGoodsTaxable('standard', 'DE')).toBe(true);
  });

  // ── Legacy bridge ─────────────────────────────────────────────────────────

  it('converts minor-unit result to legacy major-unit shape', () => {
    const result = {
      status: 'matched' as const,
      jurisdictionKey: 'DE',
      matchedKey: 'DE',
      currency: 'EUR',
      taxableAmountMinor: 10_000,
      taxAmountMinor: 1_900,
      rateBps: 1900,
      taxType: 'vat' as const,
      isExempt: false,
      isReverseCharge: false,
      policy: null as any,
    };

    const legacy = toLegacyTaxCalculation(result);
    expect(legacy.taxAmount).toBe(19); // 1900 minor -> 19.00 major
    expect(legacy.taxRateBps).toBe(1900);
    expect(legacy.taxType).toBe('vat');
    expect(legacy.jurisdictionKey).toBe('DE');
  });

  // ── Observability ─────────────────────────────────────────────────────────

  it('records metrics on calculation and rejection', () => {
    const svc = new TaxPolicyService();
    svc.calculate({
      subtotalMinor: 10_000,
      currency: 'EUR',
      jurisdiction: makeJurisdiction({ country: 'DE' }),
    });
    try {
      svc.calculate({
        subtotalMinor: -1,
        currency: 'EUR',
        jurisdiction: makeJurisdiction({ country: 'DE' }),
      });
    } catch { /* expected */ }
    const snap = (svc as any).metrics.getSnapshot?.();
    if (snap) {
      expect(snap.matched).toBeGreaterThan(0);
      expect(snap.rejected).toBeGreaterThan(0);
    }
  });

  // ── Effective date window ─────────────────────────────────────────────────

  it('respects effectiveFrom / effectiveUntil on custom policies', () => {
    const future = Date.now() + 86_400_000;
    const past = Date.now() - 86_400_000;
    const policies: TaxPolicy[] = [
      {
        jurisdictionKey: 'DE',
        taxType: 'vat',
        rateBps: 1900,
        displayName: 'DE old',
        effectiveFrom: 0,
        effectiveUntil: future,
        appliesToDigitalGoods: true,
        reverseCharge: false,
        nexusThreshold: 0,
      },
      {
        jurisdictionKey: 'DE',
        taxType: 'vat',
        rateBps: 2100,
        displayName: 'DE new',
        effectiveFrom: future,
        effectiveUntil: 0,
        appliesToDigitalGoods: true,
        reverseCharge: false,
        nexusThreshold: 0,
      },
    ];

    const svcNow = new TaxPolicyService({ policies, now: () => Date.now() });
    const r1 = svcNow.resolve(makeJurisdiction({ country: 'DE' }));
    expect(r1.policy?.rateBps).toBe(1900);

    const svcFuture = new TaxPolicyService({ policies, now: () => future + 1 });
    const r2 = svcFuture.resolve(makeJurisdiction({ country: 'DE' }));
    expect(r2.policy?.rateBps).toBe(2100);
  });
});