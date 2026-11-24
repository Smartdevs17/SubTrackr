/**
 * backend/src/lib/providerId.ts
 *
 * Issue #2256 — Normalise provider identifiers behind a stable canonical-id resolver.
 *
 * Different billing providers (Stripe, PayPal, Paddle) use different ID formats
 * for the same logical entity (customer, subscription, charge, …). This module
 * resolves any provider-specific identifier to a single stable canonical ID so
 * the rest of SubTrackr can store, compare and join on one ID space.
 *
 * Design rules:
 *  - Pure functions: no I/O, no network, no clock reads.
 *  - Deterministic: same (provider, kind, providerId) always yields the same
 *    canonicalId, without a database lookup.
 *  - Typed errors: every failure is a ProviderIdError with a stable `code`.
 *  - Provider ID validation per provider (Stripe `cus_`, PayPal `CUST-`, …).
 *  - A mutable registry stores canonical → provider-specific mappings for
 *    denormalisation (reverse lookup).
 *
 * Usage:
 *   import { canonicalize, lookupProviderId, ProviderIdError } from '../lib/providerId';
 *   const canonical = canonicalize('stripe', 'customer', 'cus_123abc');
 *   const stripeId = lookupProviderId(canonical, 'stripe', 'customer'); // 'cus_123abc'
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type BillingProvider = 'stripe' | 'paypal' | 'paddle';

export type ProviderIdKind =
  | 'customer'
  | 'subscription'
  | 'charge'
  | 'refund'
  | 'invoice'
  | 'payout';

export type ProviderId = string;

export type CanonicalId = string & { readonly __canonicalIdBrand: unique symbol };

export interface ProviderIdResolution {
  canonicalId: CanonicalId;
  provider: BillingProvider;
  kind: ProviderIdKind;
  providerId: ProviderId;
}

export interface ProviderIdMapping {
  canonicalId: CanonicalId;
  provider: BillingProvider;
  kind: ProviderIdKind;
  providerId: ProviderId;
}

// ── Errors ─────────────────────────────────────────────────────────────────────

export type ProviderIdErrorCode =
  | 'INVALID_PROVIDER'
  | 'INVALID_PROVIDER_ID'
  | 'UNKNOWN_CANONICAL_ID'
  | 'MAPPING_CONFLICT'
  | 'UNSUPPORTED_KIND';

export class ProviderIdError extends Error {
  readonly code: ProviderIdErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ProviderIdErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'ProviderIdError';
    this.code = code;
    this.details = details;
  }
}

// ── Provider ID validation patterns ────────────────────────────────────────────

/**
 * Per-provider validation regexes. Each provider prefixes its IDs with a
 * stable namespace (`cus_`, `sub_`, `pi_`, … for Stripe). Unknown or
 * malformed IDs are rejected rather than silently normalised.
 */
const PROVIDER_ID_PATTERNS: Record<BillingProvider, RegExp> = {
  stripe: /^(cus|sub|pi|in|ch|py|acct)_[A-Za-z0-9]+/,
  paypal: /^(CUST|P|CAPT|AUTH|ORD|INV|PAYID)-/i,
  paddle: /^(ctm|sub|inv|txn|ref)_[A-Za-z0-9]+/,
};

/** Entity-kind prefixes used when composing canonical IDs. */
const KIND_PREFIX: Record<ProviderIdKind, string> = {
  customer: 'cust',
  subscription: 'sub',
  charge: 'chg',
  refund: 'rfd',
  invoice: 'inv',
  payout: 'pay',
};

// ── Core logic ─────────────────────────────────────────────────────────────────

/**
 * Validate a provider-specific identifier against that provider's ID format.
 */
export function isValidProviderId(
  provider: BillingProvider,
  providerId: ProviderId
): boolean {
  if (typeof providerId !== 'string' || providerId.trim().length === 0) {
    return false;
  }
  const pattern = PROVIDER_ID_PATTERNS[provider];
  if (!pattern) return false;
  return pattern.test(providerId);
}

/**
 * Compute a stable canonical ID from (provider, kind, providerId).
 *
 * The hash is FNV-1a over the composed key, hex-encoded with a `canon:` prefix.
 * Because it is deterministic, no registry lookup is needed to canonicalise.
 */
export function canonicalize(
  provider: BillingProvider,
  kind: ProviderIdKind,
  providerId: ProviderId
): CanonicalId {
  if (!PROVIDER_ID_PATTERNS[provider]) {
    throw new ProviderIdError(
      'INVALID_PROVIDER',
      `Unknown billing provider "${provider}"`,
      { provider }
    );
  }
  if (!isValidProviderId(provider, providerId)) {
    throw new ProviderIdError(
      'INVALID_PROVIDER_ID',
      `Provider ID "${providerId}" does not match ${provider} ID format`,
      { provider, providerId }
    );
  }
  if (!KIND_PREFIX[kind]) {
    throw new ProviderIdError(
      'UNSUPPORTED_KIND',
      `Unknown provider-ID kind "${kind}"`,
      { kind }
    );
  }

  const key = `${provider}:${kind}:${providerId}`;
  const hash = fnv1a32(key);
  const hex = hash.toString(16).padStart(8, '0');
  return `canon:${hex}` as CanonicalId;
}

/**
 * Resolve a provider ID to a full ProviderIdResolution, validating along the way.
 */
export function resolveProviderId(
  provider: BillingProvider,
  kind: ProviderIdKind,
  providerId: ProviderId
): ProviderIdResolution {
  const canonicalId = canonicalize(provider, kind, providerId);
  return {
    canonicalId,
    provider,
    kind,
    providerId,
  };
}

// ── Registry (canonical → provider-specific, mutable) ─────────────────────────

/**
 * In-memory registry of canonical → provider-specific ID mappings.
 * Used for denormalisation (reverse lookup). Not required for canonicalise.
 */
class ProviderIdRegistry {
  private readonly byCanonical = new Map<string, ProviderIdMapping>();
  private readonly byProvider = new Map<string, ProviderIdMapping[]>();

  /** Register a mapping. Throws if a conflicting mapping already exists. */
  register(mapping: ProviderIdMapping): void {
    const existing = this.byCanonical.get(mapping.canonicalId);
    if (existing) {
      const same =
        existing.provider === mapping.provider &&
        existing.kind === mapping.kind &&
        existing.providerId === mapping.providerId;
      if (!same) {
        throw new ProviderIdError(
          'MAPPING_CONFLICT',
          `Canonical ID ${mapping.canonicalId} already maps to a different provider ID`,
          {
            canonicalId: mapping.canonicalId,
            existing: existing.providerId,
            attempted: mapping.providerId,
          }
        );
      }
      return; // identical mapping already registered
    }

    this.byCanonical.set(mapping.canonicalId, mapping);

    const providerKey = `${mapping.provider}:${mapping.kind}:${mapping.providerId}`;
    const list = this.byProvider.get(providerKey) ?? [];
    if (!list.find((m) => m.canonicalId === mapping.canonicalId)) {
      list.push(mapping);
      this.byProvider.set(providerKey, list);
    }
  }

  /** Look up the provider-specific ID for a canonical ID. */
  lookup(
    canonicalId: CanonicalId,
    provider: BillingProvider,
    kind: ProviderIdKind
  ): ProviderId | null {
    const mapping = this.byCanonical.get(canonicalId);
    if (!mapping) return null;
    if (mapping.provider !== provider || mapping.kind !== kind) return null;
    return mapping.providerId;
  }

  /** Look up the canonical ID for a provider-specific ID. */
  lookupCanonical(
    provider: BillingProvider,
    kind: ProviderIdKind,
    providerId: ProviderId
  ): CanonicalId | null {
    const providerKey = `${provider}:${kind}:${providerId}`;
    const list = this.byProvider.get(providerKey);
    if (!list) return null;
    return list[0]?.canonicalId ?? null;
  }

  /** Clear all mappings (mainly for tests). */
  clear(): void {
    this.byCanonical.clear();
    this.byProvider.clear();
  }
}

/** Singleton registry instance. */
const registry = new ProviderIdRegistry();

/**
 * Register a canonical → provider-specific ID mapping for reverse lookup.
 */
export function registerProviderIdMapping(
  mapping: ProviderIdMapping
): void {
  registry.register(mapping);
}

/**
 * Look up the provider-specific ID for a canonical ID. Returns null if no
 * mapping exists (canonical IDs can still be computed without registration).
 */
export function lookupProviderId(
  canonicalId: CanonicalId,
  provider: BillingProvider,
  kind: ProviderIdKind
): ProviderId | null {
  return registry.lookup(canonicalId, provider, kind);
}

/**
 * Look up the canonical ID for a provider-specific ID, if previously registered.
 */
export function lookupCanonicalProviderId(
  provider: BillingProvider,
  kind: ProviderIdKind,
  providerId: ProviderId
): CanonicalId | null {
  return registry.lookupCanonical(provider, kind, providerId);
}

/** Clear the registry (mainly for tests). */
export function clearProviderIdRegistry(): void {
  registry.clear();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** FNV-1a 32-bit hash, returns an unsigned integer. */
function fnv1a32(input: string): number {
  let hash = 0x811c_9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.codePointAt(i) as number;
    hash = Math.imul(hash, 0x0100_0193) >>> 0;
  }
  return hash >>> 0;
}

/** Default export: a convenient object with all named functions. */
export const providerId = {
  canonicalize,
  resolveProviderId,
  isValidProviderId,
  registerProviderIdMapping,
  lookupProviderId,
  lookupCanonicalProviderId,
  clearProviderIdRegistry,
} as const;
