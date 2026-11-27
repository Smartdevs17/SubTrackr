/**
 * packages/billing-types/src/index.ts
 *
 * Shared, dependency-free type definitions and constants for canonical
 * provider identifiers (issue #2256).
 *
 * A "canonical provider id" is a stable, provider-agnostic string of the form
 *
 *     <provider>:<normalized-id>-<hash>
 *
 * e.g. `stripe:1a2b3c4d-9f8e7d6c`. It is produced by the resolver in
 * `backend/src/lib/providerId.ts`; this package owns only the vocabulary
 * (providers, prefixes, limits, pattern, version) so the backend and any
 * consumer agree on the wire format without importing implementation code.
 */

/** Semantic version of the canonical-id wire format. Bump on breaking changes. */
export const CANONICAL_ID_VERSION = '1';

/**
 * Default maximum length of the normalized (ASCII-folded) identifier segment.
 * Resolvers reject longer inputs rather than silently truncating them.
 */
export const MAX_NORMALIZED_ID_LENGTH = 128;

/** Default for whether providers outside {@link KNOWN_PROVIDERS} are accepted. */
export const DEFAULT_ALLOW_CUSTOM_PROVIDERS = true;

/**
 * Providers recognised out of the box. Values are already lower-case so they
 * can be compared directly against a normalised provider token.
 */
export const KNOWN_PROVIDERS = Object.freeze([
  'stripe',
  'paypal',
  'github',
  'openai',
  'anthropic',
  'slack',
] as const);

/** Union of the built-in provider identifiers. */
export type ProviderKind = (typeof KNOWN_PROVIDERS)[number];

/**
 * Pattern every canonical id produced by the resolver matches.
 * No `g` flag: safe to reuse with `RegExp.prototype.test`.
 */
export const CANONICAL_ID_PATTERN: RegExp =
  /^[a-z][a-z0-9_-]{0,31}:[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}$/;

/** Regex source for environments that cannot share a RegExp instance. */
export const CANONICAL_ID_PATTERN_SOURCE: string = CANONICAL_ID_PATTERN.source;

/** A string already normalised into the canonical wire format. */
export type CanonicalProviderId = string;

/**
 * Identifier prefixes stripped by each provider before normalisation.
 * Configurable on the resolver; this is the shared default.
 */
export const PROVIDER_PREFIXES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    stripe: Object.freeze([
      'cus', 'ch', 'pi', 'sub', 'inv', 're', 'po', 'evt', 'pm', 'txn', 'price', 'prod',
    ]),
    paypal: Object.freeze(['pay', 'ipn', 'txn', 'inv']),
    github: Object.freeze(['gh', 'repo', 'org', 'evt']),
    openai: Object.freeze(['chatcmpl', 'file', 'ft']),
    anthropic: Object.freeze(['msg', 'msgbatch']),
    // Slack object ids use single-letter prefixes (C/U/...); stripping those
    // would mangle ordinary ids, so no prefix is removed for this provider.
    slack: Object.freeze([]),
  });

/** Stable error codes emitted by the canonical-id resolver. */
export const PROVIDER_ID_ERROR_CODES = Object.freeze({
  INVALID_CONFIG: 'INVALID_CONFIG',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_PROVIDER: 'INVALID_PROVIDER',
  UNKNOWN_PROVIDER: 'UNKNOWN_PROVIDER',
  INVALID_EXTERNAL_ID: 'INVALID_EXTERNAL_ID',
  EXTERNAL_ID_TOO_LONG: 'EXTERNAL_ID_TOO_LONG',
  INVALID_CANONICAL_ID: 'INVALID_CANONICAL_ID',
} as const);

/** Union of every stable canonical-id error code. */
export type ProviderIdErrorCode =
  (typeof PROVIDER_ID_ERROR_CODES)[keyof typeof PROVIDER_ID_ERROR_CODES];
