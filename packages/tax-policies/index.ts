/**
 * packages/tax-policies
 *
 * Provider-agnostic tax policy engine shared by the backend billing services,
 * the developer portal and the mobile app.
 *
 * Design rules (issue #2260):
 *  - Pure functions only: no I/O, no provider SDK calls, no clock reads and no
 *    randomness. The same input always produces the same output, which is what
 *    makes invoices reproducible and audits possible.
 *  - Money is always integer minor units, so totals never drift through
 *    IEEE-754 rounding. Basis points (1/100th of a percent) express rates.
 *  - Jurisdiction data lives here and nowhere else. Providers (Stripe Tax,
 *    Avalara, TaxJar, …) become adapters that translate into these shapes
 *    instead of owning policy.
 *  - Every rejection is a typed `TaxPolicyError` with a stable `code`, so
 *    callers can map failures to HTTP responses or job retries without
 *    string-matching messages.
 *
 * Import by relative path (`../../packages/tax-policies`), matching the other
 * dependency-free packages in this repo.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaxType =
  | 'none'
  | 'vat'
  | 'gst'
  | 'sales_tax'
  | 'digital_services_tax'
  | 'pst'
  | 'qst'
  | 'hst';

export type DigitalGoodsClass =
  | 'standard'
  | 'electronic_service'
  | 'exempt'
  | 'reduced_rate'
  | 'telecom_service';

export interface TaxJurisdiction {
  /** ISO-3166 alpha-2 country code, e.g. `US`, `DE`. */
  country: string;
  /** State / province / region code, e.g. `CA`, `ON`. */
  state?: string;
  /** City code, e.g. `NYC`. */
  city?: string;
}

/**
 * A single rate rule for one jurisdiction. `effectiveFrom` / `effectiveUntil`
 * are epoch milliseconds; `0` means "open ended" on either side, which keeps
 * the built-in table declarative while still supporting dated rate changes.
 */
export interface TaxPolicy {
  jurisdictionKey: string;
  taxType: TaxType;
  rateBps: number;
  displayName: string;
  effectiveFrom: number;
  effectiveUntil: number;
  appliesToDigitalGoods: boolean;
  reverseCharge: boolean;
  nexusThreshold: number;
  /**
   * ISO-4217 codes this policy may be billed in. Omitted or empty means the
   * policy is currency agnostic (any supported currency).
   */
  currencies?: readonly string[];
}

export interface DigitalGoodsTaxRule {
  classification: DigitalGoodsClass;
  country: string;
  state?: string;
  isTaxable: boolean;
  reducedRateBps?: number;
  notes: string;
}

export type TaxPolicyErrorCode =
  | 'INVALID_REGION'
  | 'INVALID_AMOUNT'
  | 'INVALID_RATE'
  | 'UNSUPPORTED_CURRENCY'
  | 'INVALID_PERIOD';

export class TaxPolicyError extends Error {
  readonly code: TaxPolicyErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: TaxPolicyErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'TaxPolicyError';
    this.code = code;
    this.details = details;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** 10,000 basis points = 100%. */
export const BPS_SCALE = 10_000;

/** Hard ceiling for a rate: 100%. */
export const MAX_RATE_BPS = BPS_SCALE;

/** Fallback key used when no country/state/city rule matches. */
export const GLOBAL_JURISDICTION_KEY = 'GLOBAL';

/**
 * Largest amount accepted per calculation, in minor units (10 billion currency
 * units). The cap keeps every intermediate product exactly representable as a
 * double so rounding is deterministic rather than approximately right.
 */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;

/**
 * ISO-4217 codes the platform bills in. Unknown codes are rejected rather than
 * silently taxed at zero, because under-collecting tax is a compliance defect.
 */
export const SUPPORTED_CURRENCIES: ReadonlySet<string> = new Set([
  'AED', 'ARS', 'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'COP',
  'CZK', 'DKK', 'EGP', 'EUR', 'GBP', 'GHS', 'HKD', 'HUF', 'IDR', 'ILS',
  'INR', 'JPY', 'KES', 'KRW', 'MAD', 'MXN', 'MYR', 'NGN', 'NOK', 'NZD',
  'PEN', 'PHP', 'PLN', 'RON', 'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'TWD',
  'UAH', 'USD', 'VND', 'XOF', 'ZAR',
]);

// ── Built-in policy data ──────────────────────────────────────────────────────

/**
 * Digital-goods classification rules. A missing rule means "taxable at the
 * jurisdiction rate", which is the safe default for SaaS.
 */
export const DIGITAL_GOODS_TAX_RULES: readonly DigitalGoodsTaxRule[] = [
  {
    classification: 'standard',
    country: 'US',
    isTaxable: true,
    notes: 'Taxable in most US states for digital goods delivered electronically',
  },
  {
    classification: 'exempt',
    country: 'US',
    isTaxable: false,
    notes: 'Exempt digital goods such as educational materials',
  },
  {
    classification: 'electronic_service',
    country: 'GB',
    isTaxable: true,
    notes: 'SaaS platforms subject to UK VAT at standard rate',
  },
  {
    classification: 'reduced_rate',
    country: 'DE',
    isTaxable: true,
    reducedRateBps: 700,
    notes: 'Reduced 7% VAT for e-books in Germany',
  },
  {
    classification: 'standard',
    country: 'AU',
    isTaxable: true,
    notes: 'GST applies to digital products and services sold to Australian consumers',
  },
  {
    classification: 'electronic_service',
    country: 'CA',
    isTaxable: true,
    notes: 'GST/HST applies to electronic services in Canada',
  },
  {
    classification: 'telecom_service',
    country: 'IN',
    isTaxable: true,
    notes: '18% GST applies to telecom and digital services in India',
  },
];

/** Built-in jurisdiction rates, resolved city -> state -> country -> GLOBAL. */
export const BUILT_IN_TAX_POLICIES: readonly TaxPolicy[] = [
  {
    jurisdictionKey: 'GB',
    taxType: 'vat',
    rateBps: 2000,
    displayName: 'UK VAT Standard Rate',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 8500000,
  },
  {
    jurisdictionKey: 'DE',
    taxType: 'vat',
    rateBps: 1900,
    displayName: 'German VAT Standard Rate',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 10000000,
  },
  {
    jurisdictionKey: 'FR',
    taxType: 'vat',
    rateBps: 2000,
    displayName: 'French VAT Standard Rate',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 10000000,
  },
  {
    jurisdictionKey: 'AU',
    taxType: 'gst',
    rateBps: 1000,
    displayName: 'Australian GST',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 7500000,
  },
  {
    jurisdictionKey: 'CA',
    taxType: 'gst',
    rateBps: 500,
    displayName: 'Canadian GST',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 3000000,
  },
  {
    jurisdictionKey: 'IN',
    taxType: 'gst',
    rateBps: 1800,
    displayName: 'Indian GST',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 2000000,
  },
  {
    jurisdictionKey: 'JP',
    taxType: 'vat',
    rateBps: 1000,
    displayName: 'Japanese Consumption Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 10000000,
  },
  {
    jurisdictionKey: 'US',
    taxType: 'sales_tax',
    rateBps: 0,
    displayName: 'US Federal (No federal sales tax)',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 0,
  },
  {
    jurisdictionKey: 'US-CA',
    taxType: 'sales_tax',
    rateBps: 850,
    displayName: 'California Sales Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 50000000,
  },
  {
    jurisdictionKey: 'US-NY',
    taxType: 'sales_tax',
    rateBps: 887,
    displayName: 'New York Sales Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 50000000,
  },
  {
    jurisdictionKey: 'US-TX',
    taxType: 'sales_tax',
    rateBps: 825,
    displayName: 'Texas Sales Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: false,
    reverseCharge: false,
    nexusThreshold: 50000000,
  },
  {
    jurisdictionKey: 'US-NY-NYC',
    taxType: 'sales_tax',
    rateBps: 887,
    displayName: 'New York City Sales Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 50000000,
  },
  {
    jurisdictionKey: 'US-FL',
    taxType: 'sales_tax',
    rateBps: 600,
    displayName: 'Florida Sales Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 50000000,
  },
  {
    jurisdictionKey: 'CA-ON',
    taxType: 'hst',
    rateBps: 1300,
    displayName: 'Ontario HST',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 3000000,
  },
  {
    jurisdictionKey: 'CA-QC',
    taxType: 'qst',
    rateBps: 997,
    displayName: 'Quebec Sales Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 3000000,
  },
  {
    jurisdictionKey: 'CA-BC',
    taxType: 'pst',
    rateBps: 700,
    displayName: 'British Columbia PST',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 3000000,
  },
];

// ── Normalisation helpers ─────────────────────────────────────────────────────

const REGION_KEY_PATTERN = /^[A-Z]{2}(-[A-Z0-9]{1,3}){0,2}$/;

/**
 * Normalise a region key such as `de`, ` us-ny ` or `US-CA-SF`.
 * Throws `INVALID_REGION` when the key is empty or not shaped like a
 * country[-state[-city]] code.
 */
export function normalizeRegionKey(region: string): string {
  if (typeof region !== 'string') {
    throw new TaxPolicyError('INVALID_REGION', 'region must be a string', { region });
  }

  const normalized = region.trim().toUpperCase().replace(/[_\s]+/g, '-');
  if (!normalized) {
    throw new TaxPolicyError('INVALID_REGION', 'region is required', { region });
  }
  if (!REGION_KEY_PATTERN.test(normalized)) {
    throw new TaxPolicyError(
      'INVALID_REGION',
      `region "${region}" is not a valid jurisdiction key (expected e.g. "DE", "US-NY")`,
      { region }
    );
  }

  return normalized;
}

/** `{ country: 'us', state: 'ny' }` -> `US-NY`. Never throws. */
export function buildJurisdictionKey(jurisdiction: TaxJurisdiction): string {
  const parts: string[] = [];
  const country = (jurisdiction.country ?? '').trim().toUpperCase();
  if (country) parts.push(country);

  const state = (jurisdiction.state ?? '').trim().toUpperCase();
  if (state) parts.push(state);

  const city = (jurisdiction.city ?? '').trim().toUpperCase();
  if (city) parts.push(city);

  return parts.join('-');
}

/**
 * Most specific first: `US-CA-SF` -> `[US-CA-SF, US-CA, US, GLOBAL]`.
 * Mirrors the lookup order the billing service has always used.
 */
export function jurisdictionFallbackKeys(jurisdiction: TaxJurisdiction): string[] {
  const parts = buildJurisdictionKey(jurisdiction).split('-').filter(Boolean);
  const keys: string[] = [];

  while (parts.length > 0) {
    keys.push(parts.join('-'));
    parts.pop();
  }
  keys.push(GLOBAL_JURISDICTION_KEY);

  return keys;
}

/** Validate a rate in basis points, returning it unchanged. */
export function assertRateBps(rateBps: number): number {
  if (typeof rateBps !== 'number' || !Number.isFinite(rateBps) || !Number.isInteger(rateBps)) {
    throw new TaxPolicyError('INVALID_RATE', 'rateBps must be an integer', { rateBps });
  }
  if (rateBps < 0 || rateBps > MAX_RATE_BPS) {
    throw new TaxPolicyError(
      'INVALID_RATE',
      `rateBps must be between 0 and ${MAX_RATE_BPS}`,
      { rateBps }
    );
  }
  return rateBps;
}

/** Validate an integer minor-unit amount, returning it unchanged. */
export function assertMinorAmount(value: number, field = 'amountMinor'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new TaxPolicyError(
      'INVALID_AMOUNT',
      `${field} must be an integer number of minor units`,
      { field, value }
    );
  }
  if (value < 0) {
    throw new TaxPolicyError('INVALID_AMOUNT', `${field} must not be negative`, {
      field,
      value,
    });
  }
  if (value > MAX_AMOUNT_MINOR) {
    throw new TaxPolicyError(
      'INVALID_AMOUNT',
      `${field} exceeds the supported maximum of ${MAX_AMOUNT_MINOR} minor units`,
      { field, value }
    );
  }
  return value;
}

/** Validate and upper-case an ISO-4217 currency code. */
export function normalizeCurrency(currency: string): string {
  const normalized = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(normalized) || !SUPPORTED_CURRENCIES.has(normalized)) {
    throw new TaxPolicyError(
      'UNSUPPORTED_CURRENCY',
      `currency "${currency}" is not a supported ISO-4217 code`,
      { currency }
    );
  }
  return normalized;
}

// ── Rate math ─────────────────────────────────────────────────────────────────

/**
 * Tax for an integer minor-unit amount, rounded half-up.
 *
 * The product is split into whole and fractional basis-point parts so the
 * intermediate values stay inside the exact-integer range of a double, even at
 * `MAX_AMOUNT_MINOR`.
 */
export function calculateTaxAmountMinor(taxableAmountMinor: number, rateBps: number): number {
  assertMinorAmount(taxableAmountMinor, 'taxableAmountMinor');
  assertRateBps(rateBps);

  const whole = Math.floor(taxableAmountMinor / BPS_SCALE) * rateBps;
  const remainder = (taxableAmountMinor % BPS_SCALE) * rateBps;

  return whole + Math.round(remainder / BPS_SCALE);
}

// ── Policy resolution ─────────────────────────────────────────────────────────

export interface TaxPolicyResolution {
  /** `unregistered` means the jurisdiction is well formed but has no policy. */
  status: 'matched' | 'unregistered';
  jurisdictionKey: string;
  /** The key that actually matched, e.g. `US-NY` for a `US-NY-NYC` lookup. */
  matchedKey: string | null;
  policy: TaxPolicy | null;
  /** Whether the digital-goods classification leaves the sale taxable. */
  digitalGoodsTaxable: boolean;
}

export interface TaxPolicyLookupOptions {
  digitalGoodsClass?: DigitalGoodsClass;
  /** Epoch ms used to select the policy in force. Omit to ignore date windows. */
  at?: number;
  policies?: readonly TaxPolicy[];
  /** Runtime overrides keyed by normalised region key. Win over built-ins. */
  overrides?: ReadonlyMap<string, TaxPolicy>;
}

function isEffective(policy: TaxPolicy, at: number | undefined): boolean {
  if (at === undefined) return true;
  if (policy.effectiveFrom > at) return false;
  if (policy.effectiveUntil !== 0 && policy.effectiveUntil <= at) return false;
  return true;
}

function selectEffectivePolicy(
  candidates: readonly TaxPolicy[],
  at: number | undefined
): TaxPolicy | null {
  let best: TaxPolicy | null = null;

  for (const candidate of candidates) {
    if (!isEffective(candidate, at)) continue;
    if (best === null || candidate.effectiveFrom > best.effectiveFrom) {
      best = candidate;
    }
  }

  return best;
}

function digitalGoodsRuleFor(
  classification: DigitalGoodsClass,
  country: string,
  state?: string
): DigitalGoodsTaxRule | undefined {
  const normalizedCountry = (country ?? '').trim().toUpperCase();
  const normalizedState = (state ?? '').trim().toUpperCase();

  return DIGITAL_GOODS_TAX_RULES.find(
    (rule) =>
      rule.classification === classification &&
      rule.country === normalizedCountry &&
      (rule.state === undefined || rule.state === normalizedState)
  );
}

/** Digital goods are taxable unless a rule says otherwise. */
export function evaluateDigitalGoodsTaxability(
  classification: DigitalGoodsClass,
  country: string,
  state?: string
): boolean {
  const rule = digitalGoodsRuleFor(classification, country, state);
  return rule ? rule.isTaxable : true;
}

function narrowForDigitalGoods(
  policy: TaxPolicy,
  jurisdiction: TaxJurisdiction,
  classification: DigitalGoodsClass | undefined
): TaxPolicy {
  if (!classification) return policy;
  if (!policy.appliesToDigitalGoods) {
    return { ...policy, rateBps: 0, taxType: 'none' };
  }

  const rule = digitalGoodsRuleFor(classification, jurisdiction.country, jurisdiction.state);
  if (!rule) return policy;
  if (!rule.isTaxable) {
    return { ...policy, rateBps: 0, taxType: 'none' };
  }
  if (rule.reducedRateBps !== undefined) {
    return { ...policy, rateBps: assertRateBps(rule.reducedRateBps) };
  }

  return policy;
}

/**
 * Resolve the policy that applies to a jurisdiction, walking
 * city -> state -> country -> GLOBAL. Overrides always win over built-ins.
 */
export function resolveTaxPolicy(
  jurisdiction: TaxJurisdiction,
  options: TaxPolicyLookupOptions = {}
): TaxPolicyResolution {
  const jurisdictionKey = buildJurisdictionKey(jurisdiction);
  const policies = options.policies ?? BUILT_IN_TAX_POLICIES;
  const keys = jurisdictionFallbackKeys(jurisdiction);

  for (const key of keys) {
    const override = options.overrides?.get(key);
    if (override && isEffective(override, options.at)) {
      const policy = narrowForDigitalGoods(override, jurisdiction, options.digitalGoodsClass);
      return {
        status: 'matched',
        jurisdictionKey,
        matchedKey: key,
        policy,
        digitalGoodsTaxable: policy.taxType !== 'none' && policy.rateBps > 0,
      };
    }

    const matched = selectEffectivePolicy(
      policies.filter((policy) => policy.jurisdictionKey === key),
      options.at
    );
    if (matched) {
      const policy = narrowForDigitalGoods(matched, jurisdiction, options.digitalGoodsClass);
      return {
        status: 'matched',
        jurisdictionKey,
        matchedKey: key,
        policy,
        digitalGoodsTaxable: policy.taxType !== 'none' && policy.rateBps > 0,
      };
    }
  }

  return {
    status: 'unregistered',
    jurisdictionKey,
    matchedKey: null,
    policy: null,
    digitalGoodsTaxable: false,
  };
}

/** Look up a policy by explicit region key (`DE`, `us-ny`, `US-CA-SF`). */
export function getTaxPolicyByKey(
  region: string,
  options: TaxPolicyLookupOptions = {}
): TaxPolicy | null {
  const key = normalizeRegionKey(region);
  const [country = '', state = '', city = ''] = key.split('-');
  return resolveTaxPolicy({ country, state, city }, options).policy;
}

/** Every policy currently known, overrides replacing built-ins by key. */
export function listTaxPolicies(options: TaxPolicyLookupOptions = {}): TaxPolicy[] {
  const merged = new Map<string, TaxPolicy>();
  for (const policy of options.policies ?? BUILT_IN_TAX_POLICIES) {
    merged.set(policy.jurisdictionKey, policy);
  }
  if (options.overrides) {
    for (const [key, policy] of options.overrides) {
      merged.set(key, policy);
    }
  }
  return Array.from(merged.values());
}

// ── Tax calculation ───────────────────────────────────────────────────────────

export interface TaxCalculationInput {
  /** Net amount being taxed, in integer minor units. */
  subtotalMinor: number;
  currency: string;
  jurisdiction: TaxJurisdiction;
  digitalGoodsClass?: DigitalGoodsClass;
  /** Customer holds a certificate valid for this jurisdiction. */
  exempt?: boolean;
  /** Cross-border B2B supply taxed under the reverse-charge mechanism. */
  reverseCharge?: boolean;
  at?: number;
  policies?: readonly TaxPolicy[];
  overrides?: ReadonlyMap<string, TaxPolicy>;
}

export interface TaxCalculation {
  status: 'matched' | 'unregistered';
  jurisdictionKey: string;
  matchedKey: string | null;
  currency: string;
  taxableAmountMinor: number;
  taxAmountMinor: number;
  rateBps: number;
  taxType: TaxType;
  isExempt: boolean;
  isReverseCharge: boolean;
  policy: TaxPolicy | null;
}

/**
 * Calculate tax for one invoice line or invoice total.
 *
 * Exempt and reverse-charge sales keep the matched policy (so the invoice can
 * show the rate that *would* apply) but collect zero tax.
 */
export function calculateTax(input: TaxCalculationInput): TaxCalculation {
  const subtotalMinor = assertMinorAmount(input.subtotalMinor, 'subtotalMinor');
  const currency = normalizeCurrency(input.currency);
  const isExempt = input.exempt === true;

  const resolution = resolveTaxPolicy(input.jurisdiction, {
    digitalGoodsClass: input.digitalGoodsClass,
    at: input.at,
    policies: input.policies,
    overrides: input.overrides,
  });

  const policy = resolution.policy;
  if (!policy) {
    return {
      status: 'unregistered',
      jurisdictionKey: resolution.jurisdictionKey,
      matchedKey: null,
      currency,
      taxableAmountMinor: 0,
      taxAmountMinor: 0,
      rateBps: 0,
      taxType: 'none',
      isExempt,
      isReverseCharge: false,
      policy: null,
    };
  }

  if (policy.currencies && policy.currencies.length > 0 && !policy.currencies.includes(currency)) {
    throw new TaxPolicyError(
      'UNSUPPORTED_CURRENCY',
      `policy ${policy.jurisdictionKey} does not bill in ${currency}`,
      { currency, jurisdictionKey: policy.jurisdictionKey }
    );
  }

  const isReverseCharge = input.reverseCharge === true || policy.reverseCharge;
  const rateBps = assertRateBps(policy.rateBps);
  const taxableAmountMinor = isExempt ? 0 : subtotalMinor;
  const taxAmountMinor =
    isExempt || isReverseCharge ? 0 : calculateTaxAmountMinor(taxableAmountMinor, rateBps);

  return {
    status: 'matched',
    jurisdictionKey: resolution.jurisdictionKey,
    matchedKey: resolution.matchedKey,
    currency,
    taxableAmountMinor,
    taxAmountMinor,
    rateBps,
    taxType: policy.taxType,
    isExempt,
    isReverseCharge,
    policy,
  };
}

// ── Mid-cycle rate changes ────────────────────────────────────────────────────

export interface RateChangeInput {
  /** Epoch ms at which `newRateBps` starts applying. */
  effectiveFrom: number;
  newRateBps: number;
}

export interface TaxSegment {
  periodStart: number;
  periodEnd: number;
  rateBps: number;
  taxableAmountMinor: number;
  taxAmountMinor: number;
}

export interface ProrationInput {
  periodStart: number;
  periodEnd: number;
  taxableAmountMinor: number;
  /** Rate in force at `periodStart`. */
  baseRateBps: number;
  /** Changes strictly inside the period; out-of-range entries are ignored. */
  changes?: readonly RateChangeInput[];
}

/**
 * Split a billing period at each rate change and tax every segment at the rate
 * in force. The taxable remainder is assigned to the final segment so the
 * segments always add up to `taxableAmountMinor` exactly — the rounding bug
 * that makes prorated invoices fail reconciliation.
 */
export function prorateTaxAcrossRateChanges(input: ProrationInput): TaxSegment[] {
  const { periodStart, periodEnd } = input;
  const taxableAmountMinor = assertMinorAmount(input.taxableAmountMinor, 'taxableAmountMinor');
  assertRateBps(input.baseRateBps);

  if (
    !Number.isFinite(periodStart) ||
    !Number.isFinite(periodEnd) ||
    periodEnd <= periodStart
  ) {
    throw new TaxPolicyError(
      'INVALID_PERIOD',
      'periodEnd must be greater than periodStart',
      { periodStart, periodEnd }
    );
  }

  const changes = (input.changes ?? [])
    .filter((change) => change.effectiveFrom > periodStart && change.effectiveFrom < periodEnd)
    .map((change) => ({ ...change, newRateBps: assertRateBps(change.newRateBps) }))
    .sort((a, b) => a.effectiveFrom - b.effectiveFrom);

  const boundaries: { start: number; end: number; rateBps: number }[] = [];
  let cursor = periodStart;
  let rateBps = input.baseRateBps;

  for (const change of changes) {
    boundaries.push({ start: cursor, end: change.effectiveFrom, rateBps });
    cursor = change.effectiveFrom;
    rateBps = change.newRateBps;
  }
  boundaries.push({ start: cursor, end: periodEnd, rateBps });

  const durationTotal = periodEnd - periodStart;
  let allocatedMinor = 0;

  return boundaries.map((boundary, index) => {
    const duration = boundary.end - boundary.start;
    const isLast = index === boundaries.length - 1;

    const segmentTaxableMinor = isLast
      ? taxableAmountMinor - allocatedMinor
      : Math.round(taxableAmountMinor * (duration / durationTotal));

    allocatedMinor += segmentTaxableMinor;

    return {
      periodStart: boundary.start,
      periodEnd: boundary.end,
      rateBps: boundary.rateBps,
      taxableAmountMinor: segmentTaxableMinor,
      taxAmountMinor: calculateTaxAmountMinor(segmentTaxableMinor, boundary.rateBps),
    };
  });
}