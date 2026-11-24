/**
 * backend/src/lib/providerId.ts
 *
 * Stable, provider-agnostic canonical-id resolver (issue #2256).
 *
 * Payment and integration providers emit wildly different identifiers
 * (`cus_AbC`, `PAY-123`, ` ch_01H ` ...). This module folds every such
 * identifier into one deterministic canonical form:
 *
 *     <provider>:<normalized-id>-<hash>
 *
 * The normalized segment is ASCII-folded and bounded in length; the 8-hex
 * FNV-1a suffix is computed from `provider\0normalized-id`, so every input
 * that is equivalent under normalisation maps to exactly one canonical id.
 * The provider is part of the hash input, keeping cross-provider ids distinct.
 *
 * Design rules:
 *  - Zero dependencies, no I/O, no clock, no ambient state. Pure data in/out.
 *  - Shared vocabulary lives in `@subtrackr/billing-types`; no duplicated
 *    constants.
 *  - Every rejection is a typed `ProviderIdError` carrying a stable `code`.
 *  - Metrics and logger hooks are optional; no-op defaults are provided.
 *
 * Usage:
 *   const resolver = createCanonicalIdResolver({}, metrics, logger);
 *   const id = resolver.canonicalize({ provider: 'stripe', externalId: 'cus_AbC' });
 *   // -> 'stripe:abc-a1b2c3d4'
 */

import {
  CANONICAL_ID_PATTERN_SOURCE,
  CANONICAL_ID_VERSION,
  DEFAULT_ALLOW_CUSTOM_PROVIDERS,
  KNOWN_PROVIDERS,
  MAX_NORMALIZED_ID_LENGTH,
  PROVIDER_ID_ERROR_CODES,
  PROVIDER_PREFIXES,
  type CanonicalProviderId,
  type ProviderIdErrorCode as SharedErrorCode,
  type ProviderKind,
} from '../../../packages/billing-types/src/index.ts';

// ---------------------------------------------------------------------------
// Error surface (re-export of the shared vocabulary)
// ---------------------------------------------------------------------------

/** Stable machine-readable codes emitted by this module. */
export const ProviderIdErrorCode = PROVIDER_ID_ERROR_CODES;

/** Union of every stable error code emitted by this module. */
export type ProviderIdErrorCode = SharedErrorCode;

/** Typed error thrown for invalid config, input and unresolvable identifiers. */
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

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

/** Raw identifier supplied by a provider, before normalisation. */
export interface ProviderIdentifier {
  /** Provider token, e.g. `stripe`, `paypal` or a configured custom name. */
  readonly provider: string;
  /** The provider's own identifier, e.g. `cus_AbC123`. */
  readonly externalId: string;
}

/** Accepted shapes for every resolver entry point. */
export type ProviderIdInput = ProviderIdentifier | string;

/**
 * Fully resolved configuration. Callers normally pass a `Partial` to
 * {@link createCanonicalIdResolver} or {@link resolveProviderId}; defaults are
 * filled in by {@link validateCanonicalIdConfig}.
 */
export interface CanonicalIdConfig {
  /** Providers accepted without enabling `allowCustomProviders`. */
  readonly knownProviders: readonly string[];
  /** Accept provider tokens outside `knownProviders` that match the token pattern. */
  readonly allowCustomProviders: boolean;
  /** Prefixes stripped per provider before normalisation. */
  readonly providerPrefixes: Readonly<Record<string, readonly string[]>>;
  /** Maximum length of the ASCII-normalized identifier segment. */
  readonly maxNormalizedLength: number;
}

/** Rich result returned by {@link resolveProviderId}. */
export interface ResolvedProviderId {
  /** Final canonical string, e.g. `stripe:abc-a1b2c3d4`. */
  readonly canonicalId: CanonicalProviderId;
  /** Normalised (lower-case) provider token. */
  readonly provider: string;
  /** Deterministic 8-hex FNV-1a suffix. */
  readonly hash: string;
  /** ASCII-folded identifier segment (without provider or hash). */
  readonly normalizedId: string;
  /** Wire-format version, from `@subtrackr/billing-types`. */
  readonly version: string;
  /** True when the input was already a canonical id and passed through. */
  readonly alreadyCanonical: boolean;
  /** The parsed source identifier that produced this result. */
  readonly source: ProviderIdentifier;
}

/** Optional metrics sink for canonical-id operations. */
export interface CanonicalIdMetrics {
  recordCanonicalized(provider: string, hash: string): void;
  recordResolved(provider: string, canonicalId: string, alreadyCanonical: boolean): void;
  recordComparison(equal: boolean): void;
  recordRejected(operation: string, code: ProviderIdErrorCode): void;
}

/** Optional logging hook for user-visible resolution events and rejections. */
export interface CanonicalIdLogger {
  info(message: string, details: Record<string, unknown>): void;
  warn(message: string, details: Record<string, unknown>): void;
}

/** Stateful façade returned by {@link createCanonicalIdResolver}. */
export interface CanonicalIdResolver {
  /** Canonicalise an identifier, returning only the canonical string. */
  canonicalize(input: ProviderIdInput): CanonicalProviderId;
  /** Canonicalise an identifier and return the full resolution record. */
  resolve(input: ProviderIdInput): ResolvedProviderId;
  /** True when two identifiers (or canonical strings) denote the same id. */
  areSame(a: ProviderIdInput, b: ProviderIdInput): boolean;
  /** Normalise only an external id; `provider` selects which prefixes to strip. */
  normalize(externalId: string, provider?: string): string;
}

/** Default configuration, mirroring `@subtrackr/billing-types`. */
export const DEFAULT_CANONICAL_ID_CONFIG: CanonicalIdConfig = Object.freeze({
  knownProviders: KNOWN_PROVIDERS,
  allowCustomProviders: DEFAULT_ALLOW_CUSTOM_PROVIDERS,
  providerPrefixes: PROVIDER_PREFIXES,
  maxNormalizedLength: MAX_NORMALIZED_ID_LENGTH,
});

/** No-op metrics implementation, safe in tests and development. */
export const noopCanonicalIdMetrics: CanonicalIdMetrics = Object.freeze({
  recordCanonicalized: () => {},
  recordResolved: () => {},
  recordComparison: () => {},
  recordRejected: () => {},
});

/** No-op logger implementation. */
export const noopCanonicalIdLogger: CanonicalIdLogger = Object.freeze({
  info: () => {},
  warn: () => {},
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Provider token syntax: lower-case start, then lower-case/digit/separator. */
const PROVIDER_TOKEN = /^[a-z][a-z0-9_-]{0,31}$/;

/**
 * Case-insensitive form used only to *recognise* canonical input. Output is
 * always validated/normalised with the strict shared `CANONICAL_ID_PATTERN`.
 */
const CANONICAL_INPUT_PATTERN = new RegExp(CANONICAL_ID_PATTERN_SOURCE, 'i');

/** Guard the raw pre-fold string so pathological inputs cannot consume CPU. */
function maxRawLength(config: CanonicalIdConfig): number {
  return config.maxNormalizedLength * 4;
}

/**
 * 32-bit FNV-1a over UTF-16 code units. Deterministic on every JS runtime and
 * dependency-free (matches the bucket hash used by `@subtrackr/flags`).
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Error helper that attaches input context to the typed error. */
function fail(code: ProviderIdErrorCode, message: string, details: Record<string, unknown>): never {
  throw new ProviderIdError(code, message, details);
}

/** Validate a provider token against syntax, allow-list and custom setting. */
function assertProvider(provider: unknown, config: CanonicalIdConfig): string {
  if (typeof provider !== 'string' || provider.trim().length === 0) {
    fail(ProviderIdErrorCode.INVALID_PROVIDER, 'provider must be a non-empty string', { provider });
  }
  const token = provider.trim().toLowerCase();
  if (!PROVIDER_TOKEN.test(token)) {
    fail(ProviderIdErrorCode.INVALID_PROVIDER, 'provider has an invalid format', { provider });
  }
  if (config.knownProviders.includes(token)) return token;
  if (config.allowCustomProviders) return token;
  return fail(
    ProviderIdErrorCode.UNKNOWN_PROVIDER,
    `provider '${token}' is not in the configured allow-list`,
    { provider: token }
  );
}

/**
 * Remove a configured prefix when it is followed by a separator or a digit,
 * e.g. `cus_123`, `PAY-99` or `ch 01`. A bare prefix (`cus` alone) is kept so a
 * legitimate id that happens to equal a prefix is never emptied by stripping.
 */
function stripPrefix(raw: string, prefixes: readonly string[]): string {
  for (const prefix of prefixes) {
    if (prefix.length === 0 || !raw.startsWith(prefix) || raw.length === prefix.length) continue;
    const rest = raw.slice(prefix.length);
    const first = rest[0]!;
    if (/[^a-z0-9]/.test(first)) return rest.replace(/^[^a-z0-9]+/, '');
    if (/[0-9]/.test(first)) return rest;
  }
  return raw;
}

/**
 * Trim, NFKC-fold, lower-case and strip the provider prefix. The returned
 * string is the prepared identity fed into {@link foldIdentity}; it is *not*
 * yet ASCII-folded.
 */
function prepareExternalId(
  externalId: unknown,
  prefixes: readonly string[],
  config: CanonicalIdConfig
): string {
  if (typeof externalId !== 'string') {
    fail(ProviderIdErrorCode.INVALID_EXTERNAL_ID, 'externalId must be a string', { externalId });
  }
  const trimmed = externalId.trim();
  if (trimmed.length === 0) {
    fail(ProviderIdErrorCode.INVALID_EXTERNAL_ID, 'externalId must not be empty', { externalId });
  }
  if (trimmed.length > maxRawLength(config)) {
    fail(
      ProviderIdErrorCode.EXTERNAL_ID_TOO_LONG,
      'externalId exceeds the maximum raw length',
      { length: trimmed.length, max: maxRawLength(config) }
    );
  }
  const folded = typeof trimmed.normalize === 'function' ? trimmed.normalize('NFKD') : trimmed;
  return stripPrefix(folded.toLowerCase(), prefixes);
}

/** ASCII-fold a prepared identity into the bounded normalized segment. */
function foldIdentity(cleaned: string, config: CanonicalIdConfig): string {
  const normalized = cleaned
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized.length === 0) {
    fail(ProviderIdErrorCode.INVALID_EXTERNAL_ID, 'externalId has no alphanumeric content', {
      cleaned,
    });
  }
  if (normalized.length > config.maxNormalizedLength) {
    fail(
      ProviderIdErrorCode.EXTERNAL_ID_TOO_LONG,
      'normalized id exceeds the maximum length',
      { length: normalized.length, max: config.maxNormalizedLength }
    );
  }
  return normalized;
}

/** Render an 8-hex FNV-1a suffix for a provider/normalized-id pair. */
function hashIdentity(provider: string, normalizedId: string): string {
  return fnv1a32(`${provider}\u0000${normalizedId}`).toString(16).padStart(8, '0');
}

/** Parse a `provider:externalId` string or a {@link ProviderIdentifier} object. */
function parseRaw(input: unknown): ProviderIdentifier {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    const separator = trimmed.indexOf(':');
    if (separator <= 0 || separator === trimmed.length - 1) {
      fail(
        ProviderIdErrorCode.INVALID_FORMAT,
        'string input must be "<provider>:<externalId>"',
        { input }
      );
    }
    return {
      provider: trimmed.slice(0, separator),
      externalId: trimmed.slice(separator + 1),
    };
  }
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    const candidate = input as Partial<ProviderIdentifier>;
    if (typeof candidate.provider !== 'string' || typeof candidate.externalId !== 'string') {
      fail(
        ProviderIdErrorCode.INVALID_INPUT,
        'object input must have string provider and externalId fields',
        { input }
      );
    }
    return { provider: candidate.provider, externalId: candidate.externalId };
  }
  return fail(
    ProviderIdErrorCode.INVALID_INPUT,
    'input must be a "<provider>:<externalId>" string or a ProviderIdentifier object',
    { input }
  );
}

/** Resolve with an already-validated config (internal hot path). */
function resolveWithConfig(input: ProviderIdInput, config: CanonicalIdConfig): ResolvedProviderId {
  const source = parseRaw(input);

  // Already-canonical strings pass through unchanged (idempotent resolver).
  if (typeof input === 'string' && CANONICAL_INPUT_PATTERN.test(input.trim())) {
    const canonicalId = input.trim().toLowerCase();
    const body = canonicalId.slice(canonicalId.indexOf(':') + 1);
    return {
      canonicalId,
      provider: canonicalId.slice(0, canonicalId.indexOf(':')),
      hash: body.slice(-8),
      normalizedId: body.slice(0, -9),
      version: CANONICAL_ID_VERSION,
      alreadyCanonical: true,
      source,
    };
  }

  const provider = assertProvider(source.provider, config);
  const cleaned = prepareExternalId(source.externalId, config.providerPrefixes[provider] ?? [], config);
  const normalizedId = foldIdentity(cleaned, config);
  const hash = hashIdentity(provider, normalizedId);
  return {
    canonicalId: `${provider}:${normalizedId}-${hash}`,
    provider,
    hash,
    normalizedId,
    version: CANONICAL_ID_VERSION,
    alreadyCanonical: false,
    source: { provider, externalId: source.externalId },
  };
}

/** Canonical string for either a raw identifier or an already-canonical string. */
function toCanonicalId(input: ProviderIdInput, config: CanonicalIdConfig): CanonicalProviderId {
  if (typeof input === 'string' && CANONICAL_INPUT_PATTERN.test(input.trim())) {
    return input.trim().toLowerCase();
  }
  return resolveWithConfig(input, config).canonicalId;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Validate and resolve a partial configuration into a complete, frozen
 * `CanonicalIdConfig`. Throws `ProviderIdError(INVALID_CONFIG)` on bad values.
 */
export function validateCanonicalIdConfig(
  config: Partial<CanonicalIdConfig> = {}
): CanonicalIdConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    fail(ProviderIdErrorCode.INVALID_CONFIG, 'config must be an object', { config });
  }

  const maxNormalizedLength = config.maxNormalizedLength ?? MAX_NORMALIZED_ID_LENGTH;
  if (
    typeof maxNormalizedLength !== 'number' ||
    !Number.isInteger(maxNormalizedLength) ||
    maxNormalizedLength < 1 ||
    maxNormalizedLength > 1024
  ) {
    fail(ProviderIdErrorCode.INVALID_CONFIG, 'maxNormalizedLength must be 1..1024', {
      maxNormalizedLength,
    });
  }

  const allowCustomProviders = config.allowCustomProviders ?? DEFAULT_ALLOW_CUSTOM_PROVIDERS;
  if (typeof allowCustomProviders !== 'boolean') {
    fail(ProviderIdErrorCode.INVALID_CONFIG, 'allowCustomProviders must be a boolean', {
      allowCustomProviders,
    });
  }

  const knownInput = config.knownProviders ?? KNOWN_PROVIDERS;
  if (!Array.isArray(knownInput) || knownInput.length === 0) {
    fail(ProviderIdErrorCode.INVALID_CONFIG, 'knownProviders must be a non-empty array', {
      knownProviders: knownInput,
    });
  }
  const knownProviders = knownInput.map((provider) => {
    if (typeof provider !== 'string' || !PROVIDER_TOKEN.test(provider.trim().toLowerCase())) {
      fail(ProviderIdErrorCode.INVALID_CONFIG, 'invalid provider in knownProviders', { provider });
    }
    return provider.trim().toLowerCase();
  });

  const prefixesInput = config.providerPrefixes ?? PROVIDER_PREFIXES;
  if (prefixesInput === null || typeof prefixesInput !== 'object' || Array.isArray(prefixesInput)) {
    fail(ProviderIdErrorCode.INVALID_CONFIG, 'providerPrefixes must be an object', {
      providerPrefixes: prefixesInput,
    });
  }
  const providerPrefixes: Record<string, readonly string[]> = {};
  for (const [key, values] of Object.entries(prefixesInput)) {
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
      fail(ProviderIdErrorCode.INVALID_CONFIG, 'each providerPrefixes entry must be string[]', {
        provider: key,
      });
    }
    providerPrefixes[key.trim().toLowerCase()] = Object.freeze(
      values.map((value) => (value as string).trim().toLowerCase())
    );
  }

  return Object.freeze({
    knownProviders: Object.freeze(Array.from(new Set(knownProviders))),
    allowCustomProviders,
    providerPrefixes: Object.freeze(providerPrefixes),
    maxNormalizedLength,
  });
}

// ---------------------------------------------------------------------------
// Pure entry points
// ---------------------------------------------------------------------------

/** Parse an identifier without normalising it. */
export function parseProviderIdentifier(input: ProviderIdInput): ProviderIdentifier {
  return parseRaw(input);
}

/**
 * Normalise an external id: trim, Unicode NFKC-fold, lower-case, strip the
 * provider's configured prefixes and collapse separators to a single `-`.
 *
 * @param externalId Raw provider identifier.
 * @param provider Optional provider used to select which prefixes to strip.
 * @param config Optional resolver configuration override.
 */
export function normalizeExternalId(
  externalId: string,
  provider?: string,
  config: Partial<CanonicalIdConfig> = {}
): string {
  const cfg = validateCanonicalIdConfig(config);
  const prefixes = provider ? cfg.providerPrefixes[provider.trim().toLowerCase()] ?? [] : [];
  return foldIdentity(prepareExternalId(externalId, prefixes, cfg), cfg);
}

/**
 * Resolve an identifier into a full {@link ResolvedProviderId} record.
 * Pure: the same input and config always produce the same output.
 */
export function resolveProviderId(
  input: ProviderIdInput,
  config: Partial<CanonicalIdConfig> = {}
): ResolvedProviderId {
  return resolveWithConfig(input, validateCanonicalIdConfig(config));
}

/**
 * Canonicalise an identifier into a stable string. Thin wrapper over
 * {@link resolveProviderId} for callers that only need the id.
 */
export function canonicalizeProviderId(
  input: ProviderIdInput,
  config: Partial<CanonicalIdConfig> = {}
): CanonicalProviderId {
  return resolveWithConfig(input, validateCanonicalIdConfig(config)).canonicalId;
}

/** True when two identifiers (or canonical strings) denote the same id. */
export function areSameProviderId(
  a: ProviderIdInput,
  b: ProviderIdInput,
  config: Partial<CanonicalIdConfig> = {}
): boolean {
  const cfg = validateCanonicalIdConfig(config);
  return toCanonicalId(a, cfg) === toCanonicalId(b, cfg);
}

// ---------------------------------------------------------------------------
// Factory with observability hooks
// ---------------------------------------------------------------------------

/**
 * Create a canonical-id resolver with optional metrics and logger hooks.
 *
 * Successful resolutions emit `recordCanonicalized`/`recordResolved` and an
 * `info` log; rejected inputs emit `recordRejected`, a `warn` log and rethrow
 * the original `ProviderIdError`.
 *
 * @param config Partial configuration; see {@link DEFAULT_CANONICAL_ID_CONFIG}.
 * @param metrics Optional metrics sink (partial implementations allowed).
 * @param logger Optional logging sink (partial implementations allowed).
 */
export function createCanonicalIdResolver(
  config: Partial<CanonicalIdConfig> = {},
  metrics: Partial<CanonicalIdMetrics> = {},
  logger: Partial<CanonicalIdLogger> = {}
): CanonicalIdResolver {
  const cfg = validateCanonicalIdConfig(config);
  const m: CanonicalIdMetrics = { ...noopCanonicalIdMetrics, ...metrics };
  const l: CanonicalIdLogger = { ...noopCanonicalIdLogger, ...logger };

  function guard<T>(operation: string, fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      const code: ProviderIdErrorCode =
        error instanceof ProviderIdError ? error.code : ProviderIdErrorCode.INVALID_INPUT;
      m.recordRejected(operation, code);
      l.warn('provider-id resolution rejected', {
        operation,
        code,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  return {
    canonicalize(input: ProviderIdInput): CanonicalProviderId {
      return guard('canonicalize', () => {
        const result = resolveWithConfig(input, cfg);
        m.recordCanonicalized(result.provider, result.hash);
        return result.canonicalId;
      });
    },

    resolve(input: ProviderIdInput): ResolvedProviderId {
      return guard('resolve', () => {
        const result = resolveWithConfig(input, cfg);
        m.recordResolved(result.provider, result.canonicalId, result.alreadyCanonical);
        l.info('provider-id resolved', {
          provider: result.provider,
          canonicalId: result.canonicalId,
          alreadyCanonical: result.alreadyCanonical,
        });
        return result;
      });
    },

    areSame(a: ProviderIdInput, b: ProviderIdInput): boolean {
      return guard('areSame', () => {
        const equal = toCanonicalId(a, cfg) === toCanonicalId(b, cfg);
        m.recordComparison(equal);
        return equal;
      });
    },

    normalize(externalId: string, provider?: string): string {
      return guard('normalize', () => {
        const prefixes = provider ? cfg.providerPrefixes[provider.trim().toLowerCase()] ?? [] : [];
        return foldIdentity(prepareExternalId(externalId, prefixes, cfg), cfg);
      });
    },
  };
}
