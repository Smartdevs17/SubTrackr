/**
 * backend/src/services/tax.ts
 *
 * Backend-facing adapter over `packages/tax-policies`.
 *
 * The policy engine is deliberately pure: it knows about jurisdictions, rates
 * and classification rules, never about providers, HTTP or the database. This
 * module adds the pieces a backend call site needs:
 *
 *  - a typed service with injected clock, override registry and metrics
 *  - structured observability for every calculation and rejection
 *  - a bridge to the legacy `TaxCalculationResult` shape so existing billing
 *    call sites can migrate without a flag day
 *
 * Issue #2260.
 */

import {
  BPS_SCALE,
  DIGITAL_GOODS_TAX_RULES,
  MAX_RATE_BPS,
  TaxPolicyError,
  buildJurisdictionKey,
  calculateTax,
  evaluateDigitalGoodsTaxability,
  listTaxPolicies,
  normalizeRegionKey,
  prorateTaxAcrossRateChanges,
  resolveTaxPolicy,
} from '../../../packages/tax-policies/index.ts';

import type {
  DigitalGoodsClass,
  ProrationInput,
  TaxCalculation,
  TaxCalculationInput,
  TaxJurisdiction,
  TaxPolicy,
  TaxPolicyResolution,
  TaxSegment,
  TaxType,
} from '../../../packages/tax-policies/index.ts';

import type {
  RegionTaxRateConfig,
  TaxCalculationResult,
} from '../../services/billing/taxTypes';

// Simple console logger shim
const logger = {
  info: (msg: string, meta?: unknown) => console.log(`[INFO] ${msg}`, meta ?? ''),
  error: (msg: string, meta?: unknown) => console.error(`[ERROR] ${msg}`, meta ?? ''),
};

export { TaxPolicyError, DIGITAL_GOODS_TAX_RULES, BPS_SCALE, MAX_RATE_BPS };
export type {
  DigitalGoodsClass,
  TaxCalculation,
  TaxJurisdiction,
  TaxPolicy,
  TaxPolicyResolution,
  TaxSegment,
  TaxType,
};

// ── Observability ─────────────────────────────────────────────────────────────

export interface TaxPolicyMetrics {
  recordCalculation(status: TaxCalculation['status'], taxType: TaxType, rateBps: number): void;
  recordRejection(code: string): void;
  recordProration(segments: number): void;
}

export const noopTaxPolicyMetrics: TaxPolicyMetrics = {
  recordCalculation: () => {},
  recordRejection: () => {},
  recordProration: () => {},
};

/**
 * Log-backed metrics. Counters live in memory so a caller can expose them from
 * a health endpoint without adding a metrics dependency to the policy package.
 */
export class StructuredTaxPolicyTelemetry implements TaxPolicyMetrics {
  private readonly totals = {
    matched: 0,
    unregistered: 0,
    rejected: 0,
    prorations: 0,
    errors: new Map<string, number>(),
  };

  recordCalculation(status: TaxCalculation['status'], taxType: TaxType, rateBps: number): void {
    if (status === 'matched') {
      this.totals.matched += 1;
    } else {
      this.totals.unregistered += 1;
    }
    logger.info('Tax policy calculation', { status, taxType, rateBps });
  }

  recordRejection(code: string): void {
    this.totals.rejected += 1;
    this.totals.errors.set(code, (this.totals.errors.get(code) ?? 0) + 1);
    logger.error('Tax policy calculation rejected', { code });
  }

  recordProration(segments: number): void {
    this.totals.prorations += 1;
    logger.info('Tax policy proration', { segments });
  }

  getSnapshot() {
    return {
      matched: this.totals.matched,
      unregistered: this.totals.unregistered,
      rejected: this.totals.rejected,
      prorations: this.totals.prorations,
      errors: Object.fromEntries(this.totals.errors),
    };
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export interface InvoiceTaxInput {
  /** Net amount in integer minor units (e.g. cents). */
  subtotalMinor: number;
  currency: string;
  jurisdiction: TaxJurisdiction;
  digitalGoodsClass?: DigitalGoodsClass;
  exempt?: boolean;
  reverseCharge?: boolean;
  /** Override the effective-date lookup, mainly for backfills and tests. */
  at?: number;
}

export type InvoiceTaxResult = TaxCalculation;

export interface TaxPolicyServiceOptions {
  metrics?: TaxPolicyMetrics;
  /** Replace the built-in table entirely (e.g. for a test or a tenant). */
  policies?: readonly TaxPolicy[];
  /** Runtime region overrides keyed by normalised region key. */
  overrides?: Map<string, TaxPolicy>;
  /** Injected clock so effective-date resolution stays testable. */
  now?: () => number;
}

export class TaxPolicyService {
  private readonly metrics: TaxPolicyMetrics;
  private readonly policies: readonly TaxPolicy[];
  private readonly overrides: Map<string, TaxPolicy>;
  private readonly now: () => number;

  constructor(options: TaxPolicyServiceOptions = {}) {
    this.metrics = options.metrics ?? noopTaxPolicyMetrics;
    this.policies = options.policies ?? listTaxPolicies();
    this.overrides = options.overrides ?? new Map<string, TaxPolicy>();
    this.now = options.now ?? (() => Date.now());
  }

  /** Resolve the policy in force for a jurisdiction. */
  resolve(jurisdiction: TaxJurisdiction, digitalGoodsClass?: DigitalGoodsClass): TaxPolicyResolution {
    return resolveTaxPolicy(jurisdiction, {
      digitalGoodsClass,
      at: this.now(),
      policies: this.policies,
      overrides: this.overrides,
    });
  }

  /**
   * Calculate tax for an invoice. Throws `TaxPolicyError` (after recording the
   * rejection) when the input cannot be billed safely — a malformed region,
   * a negative or fractional amount, or a currency the policy does not support.
   */
  calculate(input: InvoiceTaxInput): InvoiceTaxResult {
    try {
      const result = calculateTax({
        ...input,
        at: input.at ?? this.now(),
        policies: this.policies,
        overrides: this.overrides,
      });

      this.metrics.recordCalculation(result.status, result.taxType, result.rateBps);
      return result;
    } catch (error) {
      if (error instanceof TaxPolicyError) {
        this.metrics.recordRejection(error.code);
      }
      throw error;
    }
  }

  /** Split a period at rate changes and tax every segment. */
  prorate(input: ProrationInput): TaxSegment[] {
    try {
      const segments = prorateTaxAcrossRateChanges(input);
      this.metrics.recordProration(segments.length);
      return segments;
    } catch (error) {
      if (error instanceof TaxPolicyError) {
        this.metrics.recordRejection(error.code);
      }
      throw error;
    }
  }

  isDigitalGoodsTaxable(classification: DigitalGoodsClass, country: string, state?: string): boolean {
    return evaluateDigitalGoodsTaxability(classification, country, state);
  }

  /** Configure (or replace) a region rate without touching the built-in table. */
  configureRegion(config: RegionTaxRateConfig): TaxPolicy {
    const region = normalizeRegionKey(config.region);
    const existing =
      this.overrides.get(region) ??
      this.policies.find((policy) => policy.jurisdictionKey === region) ??
      null;

    const policy: TaxPolicy = {
      jurisdictionKey: region,
      taxType: config.taxType ?? existing?.taxType ?? 'vat',
      rateBps: Math.round(config.rateBps),
      displayName: config.displayName ?? existing?.displayName ?? `${region} Tax Rate`,
      effectiveFrom: existing?.effectiveFrom ?? 0,
      effectiveUntil: existing?.effectiveUntil ?? 0,
      appliesToDigitalGoods: existing?.appliesToDigitalGoods ?? true,
      reverseCharge: existing?.reverseCharge ?? false,
      nexusThreshold: existing?.nexusThreshold ?? 0,
    };

    // Validate through the same guards the calculation path uses.
    assertRegionPolicy(policy);
    this.overrides.set(region, policy);
    logger.info('Tax policy region configured', { region, rateBps: policy.rateBps });
    return policy;
  }

  getRegionPolicy(region: string): TaxPolicy | null {
    return this.overrides.get(normalizeRegionKey(region)) ?? null;
  }

  listRegionPolicies(): TaxPolicy[] {
    return Array.from(this.overrides.values());
  }

  clearRegion(region: string): boolean {
    return this.overrides.delete(normalizeRegionKey(region));
  }

  clearRegions(): void {
    this.overrides.clear();
  }

  /** Built-in table merged with configured overrides. */
  listPolicies(): TaxPolicy[] {
    return listTaxPolicies({ policies: this.policies, overrides: this.overrides });
  }

  /** Jurisdiction key for a jurisdiction, e.g. `US-NY-NYC`. */
  jurisdictionKey(jurisdiction: TaxJurisdiction): string {
    return buildJurisdictionKey(jurisdiction);
  }
}

function assertRegionPolicy(policy: TaxPolicy): void {
  if (!Number.isInteger(policy.rateBps) || policy.rateBps < 0 || policy.rateBps > MAX_RATE_BPS) {
    throw new TaxPolicyError(
      'INVALID_RATE',
      `rateBps must be an integer between 0 and ${MAX_RATE_BPS}`,
      { rateBps: policy.rateBps }
    );
  }
}

// ── Legacy bridge ─────────────────────────────────────────────────────────────

/**
 * Map a minor-unit calculation onto the major-unit `TaxCalculationResult`
 * shape still returned by `backend/services/billing/taxService.ts`.
 *
 * Amounts are converted back to whole major units because that is what the
 * legacy contract promises; new call sites should use `taxAmountMinor` and stay
 * in minor units end to end.
 */
export function toLegacyTaxCalculation(result: TaxCalculation): TaxCalculationResult {
  return {
    taxAmount: Math.round(result.taxAmountMinor / 100),
    taxRateBps: result.rateBps,
    taxType: result.taxType,
    jurisdictionKey: result.jurisdictionKey,
    isExempt: result.isExempt,
    isReverseCharge: result.isReverseCharge,
    midCycleChanges: [],
  };
}