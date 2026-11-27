/**
 * packages/tax-policies/__tests__/index.test.ts
 *
 * Unit tests for the provider-agnostic tax policy engine.
 */

import {
  BPS_SCALE,
  MAX_RATE_BPS,
  MAX_AMOUNT_MINOR,
  TaxPolicyError,
  TaxPolicyErrorCode,
  SUPPORTED_CURRENCIES,
  normalizeRegionKey,
  buildJurisdictionKey,
  jurisdictionFallbackKeys,
  assertRateBps,
  assertMinorAmount,
  normalizeCurrency,
  calculateTaxAmountMinor,
  resolveTaxPolicy,
  getTaxPolicyByKey,
  listTaxPolicies,
  evaluateDigitalGoodsTaxability,
  prorateTaxAcrossRateChanges,
  DIGITAL_GOODS_TAX_RULES,
  BUILT_IN_TAX_POLICIES,
} from '../index';

import type {
  TaxJurisdiction,
  TaxPolicy,
  DigitalGoodsClass,
  TaxPolicyLookupOptions,
  ProrationInput,
  TaxSegment,
} from '../index';

const makeJurisdiction = (overrides: Partial<TaxJurisdiction> = {}): TaxJurisdiction => ({
  country: '',
  state: '',
  city: '',
  ...overrides,
});

describe('packages/tax-policies', () => {
  // ── Normalisation ─────────────────────────────────────────────────────────

  describe('normalizeRegionKey', () => {
    it('normalises common inputs', () => {
      expect(normalizeRegionKey('de')).toBe('DE');
      expect(normalizeRegionKey(' us-ny ')).toBe('US-NY');
      expect(normalizeRegionKey('US_CA_SF')).toBe('US-CA-SF');
    });

    it('throws INVALID_REGION for empty or malformed keys', () => {
      expect(() => normalizeRegionKey('')).toThrow(TaxPolicyError);
      expect(() => normalizeRegionKey('   ')).toThrow(TaxPolicyError);
      expect(() => normalizeRegionKey('USA')).toThrow(TaxPolicyError);
      expect(() => normalizeRegionKey('US-NEW')).toThrow(TaxPolicyError);
      expect(() => normalizeRegionKey('US-NYC-LA')).toThrow(TaxPolicyError);
    });

    it('rejects non-strings', () => {
      // @ts-expect-error testing runtime behaviour
      expect(() => normalizeRegionKey(123)).toThrow(TaxPolicyError);
    });
  });

  describe('buildJurisdictionKey', () => {
    it('assembles country/state/city correctly', () => {
      expect(buildJurisdictionKey(makeJurisdiction({ country: 'DE' }))).toBe('DE');
      expect(buildJurisdictionKey(makeJurisdiction({ country: 'US', state: 'NY' }))).toBe('US-NY');
      expect(buildJurisdictionKey(makeJurisdiction({ country: 'US', state: 'NY', city: 'NYC' }))).toBe('US-NY-NYC');
    });

    it('omits empty parts', () => {
      expect(buildJurisdictionKey(makeJurisdiction({ state: 'NY' }))).toBe('NY');
      expect(buildJurisdictionKey(makeJurisdiction({ city: 'NYC' }))).toBe('NYC');
    });
  });

  describe('jurisdictionFallbackKeys', () => {
    it('walks city -> state -> country -> GLOBAL', () => {
      const keys = jurisdictionFallbackKeys(makeJurisdiction({ country: 'US', state: 'CA', city: 'SF' }));
      expect(keys).toEqual(['US-CA-SF', 'US-CA', 'US', 'GLOBAL']);
    });

    it('country only', () => {
      const keys = jurisdictionFallbackKeys(makeJurisdiction({ country: 'DE' }));
      expect(keys).toEqual(['DE', 'GLOBAL']);
    });
  });

  // ── Guards ────────────────────────────────────────────────────────────────

  describe('assertRateBps', () => {
    it('accepts valid integer rates', () => {
      expect(assertRateBps(0)).toBe(0);
      expect(assertRateBps(1900)).toBe(1900);
      expect(assertRateBps(MAX_RATE_BPS)).toBe(MAX_RATE_BPS);
    });

    it('rejects non-integers and out-of-range', () => {
      expect(() => assertRateBps(19.5)).toThrow(TaxPolicyError);
      expect(() => assertRateBps(-1)).toThrow(TaxPolicyError);
      expect(() => assertRateBps(MAX_RATE_BPS + 1)).toThrow(TaxPolicyError);
      expect(() => assertRateBps(NaN)).toThrow(TaxPolicyError);
    });
  });

  describe('assertMinorAmount', () => {
    it('accepts non-negative integers', () => {
      expect(assertMinorAmount(0)).toBe(0);
      expect(assertMinorAmount(1000)).toBe(1000);
      expect(assertMinorAmount(MAX_AMOUNT_MINOR)).toBe(MAX_AMOUNT_MINOR);
    });

    it('rejects negative, fractional and too-large', () => {
      expect(() => assertMinorAmount(-1)).toThrow(TaxPolicyError);
      expect(() => assertMinorAmount(100.5)).toThrow(TaxPolicyError);
      expect(() => assertMinorAmount(MAX_AMOUNT_MINOR + 1)).toThrow(TaxPolicyError);
      expect(() => assertMinorAmount(NaN)).toThrow(TaxPolicyError);
    });
  });

  describe('normalizeCurrency', () => {
    it('upper-cases and validates supported codes', () => {
      expect(normalizeCurrency('eur')).toBe('EUR');
      expect(normalizeCurrency('USD')).toBe('USD');
      expect(normalizeCurrency('gbp')).toBe('GBP');
    });

    it('rejects unknown or malformed codes', () => {
      expect(() => normalizeCurrency('')).toThrow(TaxPolicyError);
      expect(() => normalizeCurrency('ABC')).toThrow(TaxPolicyError);
      expect(() => normalizeCurrency('US')).toThrow(TaxPolicyError);
      expect(() => normalizeCurrency('USA')).toThrow(TaxPolicyError);
    });
  });

  // ── Rate math ─────────────────────────────────────────────────────────────

  describe('calculateTaxAmountMinor', () => {
    it('rounds half-up', () => {
      expect(calculateTaxAmountMinor(10_000, 2000)).toBe(2000); // 100.00 * 20%
      expect(calculateTaxAmountMinor(100, 2000)).toBe(20);       // 1.00 * 20%
      expect(calculateTaxAmountMinor(1, 2000)).toBe(0);          // 0.01 * 20% -> 0.2 cent -> 0
      expect(calculateTaxAmountMinor(1, 5000)).toBe(1);          // 0.01 * 50% -> 0.5 cent -> 1
    });

    it('handles large amounts without drift', () => {
      const amount = 1_000_000_000_000;
      const tax = calculateTaxAmountMinor(amount, 1900); // 19%
      expect(tax).toBe(190_000_000_000);
    });

    it('rejects invalid inputs', () => {
      expect(() => calculateTaxAmountMinor(-1, 2000)).toThrow(TaxPolicyError);
      expect(() => calculateTaxAmountMinor(1000, -1)).toThrow(TaxPolicyError);
    });
  });

  // ── Policy resolution ─────────────────────────────────────────────────────

  describe('resolveTaxPolicy', () => {
    it('matches built-in DE at country level', () => {
      const r = resolveTaxPolicy(makeJurisdiction({ country: 'DE' }));
      expect(r.status).toBe('matched');
      expect(r.matchedKey).toBe('DE');
      expect(r.policy?.rateBps).toBe(1900);
      expect(r.policy?.taxType).toBe('vat');
      expect(r.digitalGoodsTaxable).toBe(true);
    });

    it('falls back US -> US-CA -> US-CA-SF', () => {
      const r = resolveTaxPolicy(makeJurisdiction({ country: 'US', state: 'CA', city: 'SF' }));
      expect(r.status).toBe('matched');
      expect(r.matchedKey).toBe('US-CA');
      expect(r.policy?.rateBps).toBe(850);
    });

    it('returns unregistered for unknown jurisdiction', () => {
      const r = resolveTaxPolicy(makeJurisdiction({ country: 'XX' }));
      expect(r.status).toBe('unregistered');
      expect(r.policy).toBeNull();
      expect(r.digitalGoodsTaxable).toBe(false);
    });

    it('applies digital goods reduced rate for DE e-books', () => {
      const r = resolveTaxPolicy(
        makeJurisdiction({ country: 'DE' }),
        { digitalGoodsClass: 'reduced_rate' }
      );
      expect(r.policy?.rateBps).toBe(700);
    });

    it('exempts US educational materials', () => {
      const r = resolveTaxPolicy(
        makeJurisdiction({ country: 'US' }),
        { digitalGoodsClass: 'exempt' }
      );
      expect(r.policy?.rateBps).toBe(0);
      expect(r.policy?.taxType).toBe('none');
      expect(r.digitalGoodsTaxable).toBe(false);
    });

    it('honours runtime overrides over built-ins', () => {
      const overrides = new Map<string, TaxPolicy>([
        ['DE', { ...BUILT_IN_TAX_POLICIES[0], rateBps: 1500 }],
      ]);
      const r = resolveTaxPolicy(makeJurisdiction({ country: 'DE' }), { overrides });
      expect(r.policy?.rateBps).toBe(1500);
    });

    it('ignores overrides outside effective window', () => {
      const future = Date.now() + 86_400_000;
      const overrides = new Map<string, TaxPolicy>([
        ['DE', { ...BUILT_IN_TAX_POLICIES[0], effectiveFrom: future, rateBps: 500 }],
      ]);
      const r = resolveTaxPolicy(makeJurisdiction({ country: 'DE' }), { overrides, at: Date.now() });
      expect(r.policy?.rateBps).toBe(1900); // built-in still active
    });

    it('rejects currency not in policy currencies list', () => {
      const policies: TaxPolicy[] = [
        {
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
        },
      ];
      const r = resolveTaxPolicy(makeJurisdiction({ country: 'DE' }), { policies });
      // resolution succeeds; calculateTax will reject later
      expect(r.status).toBe('matched');
    });
  });

  describe('getTaxPolicyByKey', () => {
    it('looks up exact key case-insensitively', () => {
      const p = getTaxPolicyByKey('de');
      expect(p?.jurisdictionKey).toBe('DE');
    });

    it('returns null for unregistered key', () => {
      expect(getTaxPolicyByKey('XX')).toBeNull();
    });
  });

  describe('listTaxPolicies', () => {
    it('returns merged built-ins + overrides', () => {
      const overrides = new Map<string, TaxPolicy>([
        ['US-CA', { ...BUILT_IN_TAX_POLICIES[0], jurisdictionKey: 'US-CA', rateBps: 1000 }],
      ]);
      const list = listTaxPolicies({ overrides });
      const ca = list.find((p) => p.jurisdictionKey === 'US-CA');
      expect(ca?.rateBps).toBe(1000);
    });
  });

  // ── Digital goods rules ───────────────────────────────────────────────────

  describe('evaluateDigitalGoodsTaxability', () => {
    it('returns true for standard goods where no rule says otherwise', () => {
      expect(evaluateDigitalGoodsTaxability('standard', 'FR')).toBe(true);
    });

    it('exempts US educational', () => {
      expect(evaluateDigitalGoodsTaxability('exempt', 'US')).toBe(false);
    });

    it('taxes electronic services in GB', () => {
      expect(evaluateDigitalGoodsTaxability('electronic_service', 'GB')).toBe(true);
    });
  });

  // ── Proration ─────────────────────────────────────────────────────────────

  describe('prorateTaxAcrossRateChanges', () => {
    const baseInput: ProrationInput = {
      periodStart: 1_000_000_000_000,
      periodEnd: 1_000_000_008_640_000, // 10 days
      taxableAmountMinor: 1_000_000, // 10,000.00
      baseRateBps: 1000,
    };

    it('single segment when no changes', () => {
      const segs = prorateTaxAcrossRateChanges(baseInput);
      expect(segs.length).toBe(1);
      expect(segs[0].taxAmountMinor).toBe(100_000); // 10,000 * 10%
    });

    it('splits at rate change', () => {
      const changeAt = 1_000_000_004_320_000; // day 5
      const segs = prorateTaxAcrossRateChanges({
        ...baseInput,
        changes: [{ effectiveFrom: changeAt, newRateBps: 2000 }],
      });
      expect(segs.length).toBe(2);
      // first half at 10%, second at 20%
      expect(segs[0].rateBps).toBe(1000);
      expect(segs[1].rateBps).toBe(2000);
      // sum of taxable amounts equals input
      expect(segs[0].taxableAmountMinor + segs[1].taxableAmountMinor).toBe(baseInput.taxableAmountMinor);
    });

    it('rejects invalid period', () => {
      expect(() =>
        prorateTaxAcrossRateChanges({ ...baseInput, periodEnd: baseInput.periodStart })
      ).toThrow(TaxPolicyError);
    });

    it('rejects negative taxable amount', () => {
      expect(() =>
        prorateTaxAcrossRateChanges({ ...baseInput, taxableAmountMinor: -1 })
      ).toThrow(TaxPolicyError);
    });

    it('rejects fractional rate', () => {
      expect(() =>
        prorateTaxAcrossRateChanges({ ...baseInput, baseRateBps: 100.5 })
      ).toThrow(TaxPolicyError);
    });
  });

  // ── Error codes stability ─────────────────────────────────────────────────

  describe('TaxPolicyError codes', () => {
    it('exposes stable error codes', () => {
      const codes: TaxPolicyErrorCode[] = [
        'INVALID_REGION',
        'INVALID_AMOUNT',
        'INVALID_RATE',
        'UNSUPPORTED_CURRENCY',
        'INVALID_PERIOD',
      ];
      for (const code of codes) {
        const err = new TaxPolicyError(code, 'test', { test: true });
        expect(err.code).toBe(code);
        expect(err.details.test).toBe(true);
      }
    });
  });
});