/**
 * backend/src/middleware/householdLoader.ts
 *
 * Household-membership loader used by the request middleware (issue #2264).
 *
 * This module is a zero-dependency, side-effect-free orchestrator. It never
 * talks to a database or a network directly: a `MembershipSource` resolver is
 * injected, and a TTL/LRU cache handle (see `backend/src/lib/cache.ts`) is
 * injected as a structural interface. The loader decides *when* to call the
 * source, *what* key to cache under, and *how* to invalidate — all
 * deterministic and unit-testable with an injectable clock.
 *
 * Design rules:
 *  - Every rejection is a typed `HouseholdLoaderError` with a stable `code`.
 *  - Deterministic, collision-free keying by household and user. Components are
 *    percent-encoded so delimiters in IDs cannot forge a different key.
 *  - Both positive and negative membership results are cached, so a
 *    non-member does not trigger a source lookup on every request.
 *  - Invalidation is supported per membership, per user (all households) and
 *    globally, which is what membership-change handlers need.
 *  - Metrics and logger hooks are optional; no-op defaults are provided.
 *  - Returned results are frozen.
 *
 * Usage:
 *   const cache = createTtlCache<MembershipLookup>({ defaultTtlMs: 30_000 });
 *   const loader = createHouseholdLoader(cache, { source: myResolver });
 *   const result = await loader.load('user-1', 'household-9');
 */

// ---------------------------------------------------------------------------
// Error surface
// ---------------------------------------------------------------------------

/** Stable machine-readable codes emitted by this module. */
export const HouseholdLoaderErrorCode = {
  INVALID_CONFIG: 'INVALID_CONFIG',
  INVALID_USER: 'INVALID_USER',
  INVALID_HOUSEHOLD: 'INVALID_HOUSEHOLD',
  INVALID_SOURCE: 'INVALID_SOURCE',
  SOURCE_ERROR: 'SOURCE_ERROR',
} as const;

/** Union of every stable error code emitted by this module. */
export type HouseholdLoaderErrorCode =
  (typeof HouseholdLoaderErrorCode)[keyof typeof HouseholdLoaderErrorCode];

/** Typed error thrown for invalid configuration, input and source failures. */
export class HouseholdLoaderError extends Error {
  readonly code: HouseholdLoaderErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: HouseholdLoaderErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'HouseholdLoaderError';
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Domain data types
// ---------------------------------------------------------------------------

/** A membership record as returned by the injected source resolver. */
export interface Membership {
  readonly userId: string;
  readonly householdId: string;
  readonly role: string;
  readonly joinedAtMs: number;
}

/**
 * The value cached by the loader. A `null` `membership` with `isMember: false`
 * represents a cached negative lookup (the user is not in the household).
 */
export interface MembershipLookup {
  readonly userId: string;
  readonly householdId: string;
  readonly isMember: boolean;
  readonly membership: Membership | null;
  /** Clock time at which this lookup was produced (ms). */
  readonly checkedAtMs: number;
  /** Where the lookup was served from. */
  readonly source: 'cache' | 'source';
}

/** Result of an invalidation operation. */
export interface InvalidationResult {
  readonly scope: 'membership' | 'user' | 'all';
  readonly removed: number;
}

// ---------------------------------------------------------------------------
// Injected dependencies (structural — no runtime import of cache.ts)
// ---------------------------------------------------------------------------

/**
 * Structural subset of the TTL cache handle consumed by the loader. Any
 * object implementing these methods satisfies the contract, which keeps the
 * module dependency-injected and free of runtime imports.
 */
export interface MembershipCache {
  get(key: string): MembershipLookup | undefined;
  set(key: string, value: MembershipLookup, ttlMs?: number): unknown;
  delete(key: string): boolean;
  clear(): number;
  has(key: string): boolean;
  size(): number;
  entries(): readonly { readonly key: string; readonly value: MembershipLookup }[];
  keys(): readonly string[];
  invalidateByPrefix(prefix: string): number;
}

/** Resolver that answers a membership question from the source of truth. */
export interface MembershipSource {
  /** Return the membership, or `null` when the user is not a member. */
  lookupMembership(
    userId: string,
    householdId: string
  ): Membership | null | Promise<Membership | null>;
}

// ---------------------------------------------------------------------------
// Configuration, hooks and constants
// ---------------------------------------------------------------------------

/** Fully resolved loader configuration. */
export interface HouseholdLoaderConfig {
  /** TTL applied to cached lookups (ms). Must be a positive finite number. */
  ttlMs: number;
  /** Injectable clock; defaults to `Date.now`. */
  nowMs: () => number;
  /** Namespace embedded at the front of every cache key. */
  keyNamespace: string;
}

/** Defaults used when a caller omits configuration values. */
export const DEFAULT_HOUSEHOLD_LOADER_CONFIG: HouseholdLoaderConfig = Object.freeze({
  ttlMs: 30_000,
  nowMs: Date.now,
  keyNamespace: 'hsmem',
});

/** Optional observability hook for loader decisions. */
export interface HouseholdLoaderMetrics {
  recordCacheHit(userId: string, householdId: string): void;
  recordCacheMiss(userId: string, householdId: string): void;
  recordSourceLookup(userId: string, householdId: string, isMember: boolean): void;
  recordInvalidation(scope: InvalidationResult['scope'], removed: number): void;
  recordSourceError(userId: string, householdId: string, code: string): void;
}

/** Optional logging hook for loader anomalies. */
export interface HouseholdLoaderLogger {
  debug(message: string, details: Record<string, unknown>): void;
  warn(message: string, details: Record<string, unknown>): void;
}

/** No-op metrics implementation, safe to use in tests and development. */
export const noopHouseholdLoaderMetrics: HouseholdLoaderMetrics = Object.freeze({
  recordCacheHit: () => {},
  recordCacheMiss: () => {},
  recordSourceLookup: () => {},
  recordInvalidation: () => {},
  recordSourceError: () => {},
});

/** No-op logger implementation. */
export const noopHouseholdLoaderLogger: HouseholdLoaderLogger = Object.freeze({
  debug: () => {},
  warn: () => {},
});

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertNonEmptyString(value: unknown, code: HouseholdLoaderErrorCode, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HouseholdLoaderError(code, `${field} must be a non-empty string`, { field, value });
  }
  return value;
}

function assertSource(source: unknown): MembershipSource {
  if (
    source === null ||
    typeof source !== 'object' ||
    typeof (source as MembershipSource).lookupMembership !== 'function'
  ) {
    throw new HouseholdLoaderError(
      HouseholdLoaderErrorCode.INVALID_SOURCE,
      'source must provide a lookupMembership function',
      { source }
    );
  }
  return source as MembershipSource;
}

function assertCache(cache: unknown): MembershipCache {
  if (
    cache === null ||
    typeof cache !== 'object' ||
    typeof (cache as MembershipCache).get !== 'function' ||
    typeof (cache as MembershipCache).set !== 'function' ||
    typeof (cache as MembershipCache).delete !== 'function' ||
    typeof (cache as MembershipCache).invalidateByPrefix !== 'function'
  ) {
    throw new HouseholdLoaderError(
      HouseholdLoaderErrorCode.INVALID_CONFIG,
      'cache must implement the MembershipCache contract',
      { cache }
    );
  }
  return cache as MembershipCache;
}

/**
 * Validate and resolve a partial loader configuration into a complete, frozen
 * `HouseholdLoaderConfig`. Throws `HouseholdLoaderError(INVALID_CONFIG)`.
 */
export function validateHouseholdLoaderConfig(
  config: Partial<HouseholdLoaderConfig> = {}
): HouseholdLoaderConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new HouseholdLoaderError(
      HouseholdLoaderErrorCode.INVALID_CONFIG,
      'config must be an object',
      { config }
    );
  }

  const ttlMs = config.ttlMs ?? DEFAULT_HOUSEHOLD_LOADER_CONFIG.ttlMs;
  if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new HouseholdLoaderError(
      HouseholdLoaderErrorCode.INVALID_CONFIG,
      'ttlMs must be a positive finite number',
      { ttlMs }
    );
  }

  const ns = config.keyNamespace ?? DEFAULT_HOUSEHOLD_LOADER_CONFIG.keyNamespace;
  const keyNamespace = assertNonEmptyString(ns, HouseholdLoaderErrorCode.INVALID_CONFIG, 'keyNamespace');

  return Object.freeze({
    ttlMs,
    keyNamespace,
    nowMs: typeof config.nowMs === 'function' ? config.nowMs : DEFAULT_HOUSEHOLD_LOADER_CONFIG.nowMs,
  });
}

/** Percent-encode a single key component so delimiters cannot collide. */
function encodeComponent(component: string): string {
  return component
    .replace(/%/g, '%25')
    .replace(/\|/g, '%7C')
    .replace(/:/g, '%3A');
}

/**
 * Build the deterministic cache key for a membership lookup.
 *
 * The format is `<namespace>|u:<encodedUser>|h:<encodedHousehold>`. Encoding
 * each component makes the key collision-free even when IDs contain the `|`
 * or `:` delimiters. The user component also forms a prefix
 * (`<namespace>|u:<encodedUser>|`) usable for user-wide invalidation.
 */
export function makeMembershipKey(
  userId: string,
  householdId: string,
  namespace: string = DEFAULT_HOUSEHOLD_LOADER_CONFIG.keyNamespace
): string {
  const u = assertNonEmptyString(userId, HouseholdLoaderErrorCode.INVALID_USER, 'userId');
  const h = assertNonEmptyString(householdId, HouseholdLoaderErrorCode.INVALID_HOUSEHOLD, 'householdId');
  const ns = assertNonEmptyString(namespace, HouseholdLoaderErrorCode.INVALID_CONFIG, 'keyNamespace');
  return `${ns}|u:${encodeComponent(u)}|h:${encodeComponent(h)}`;
}

/** Build the key prefix that matches every household for one user. */
export function makeUserPrefix(
  userId: string,
  namespace: string = DEFAULT_HOUSEHOLD_LOADER_CONFIG.keyNamespace
): string {
  const u = assertNonEmptyString(userId, HouseholdLoaderErrorCode.INVALID_USER, 'userId');
  const ns = assertNonEmptyString(namespace, HouseholdLoaderErrorCode.INVALID_CONFIG, 'keyNamespace');
  return `${ns}|u:${encodeComponent(u)}|`;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/** Loader handle returned by {@link createHouseholdLoader}. */
export interface HouseholdLoader {
  /** Resolve membership, serving from cache when a fresh entry exists. */
  load(userId: string, householdId: string): Promise<MembershipLookup>;
  /** Invalidate the cached lookup for one (user, household) pair. */
  invalidate(userId: string, householdId: string): InvalidationResult;
  /** Invalidate every cached household for one user. */
  invalidateUser(userId: string): InvalidationResult;
  /** Invalidate everything the loader has cached. */
  invalidateAll(): InvalidationResult;
  /** Build the cache key used for a membership pair (exposed for debugging). */
  keyFor(userId: string, householdId: string): string;
  /** The fully resolved, frozen configuration. */
  readonly config: HouseholdLoaderConfig;
}

function freezeLookup(lookup: MembershipLookup): MembershipLookup {
  return Object.freeze({
    userId: lookup.userId,
    householdId: lookup.householdId,
    isMember: lookup.isMember,
    membership: lookup.membership ? Object.freeze({ ...lookup.membership }) : null,
    checkedAtMs: lookup.checkedAtMs,
    source: lookup.source,
  });
}

function validateMembershipRecord(
  value: unknown,
  userId: string,
  householdId: string,
  source: MembershipSource
): Membership | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HouseholdLoaderError(
      HouseholdLoaderErrorCode.SOURCE_ERROR,
      'source returned a malformed membership',
      { userId, householdId }
    );
  }
  const record = value as Partial<Membership>;
  const returnedUser =
    typeof record.userId === 'string' && record.userId.length > 0 ? record.userId : userId;
  const returnedHousehold =
    typeof record.householdId === 'string' && record.householdId.length > 0
      ? record.householdId
      : householdId;
  const role = typeof record.role === 'string' && record.role.length > 0 ? record.role : 'member';
  const joinedAtMs =
    typeof record.joinedAtMs === 'number' && Number.isFinite(record.joinedAtMs)
      ? record.joinedAtMs
      : 0;
  void source; // resolver identity retained for diagnostics in the error path above
  return Object.freeze({
    userId: returnedUser,
    householdId: returnedHousehold,
    role,
    joinedAtMs,
  });
}

/**
 * Create a household membership loader on top of an injected cache.
 *
 * @param cache A TTL cache handle (structural `MembershipCache` subset).
 * @param deps Injected dependencies, including the membership source resolver.
 * @param config Partial configuration; see {@link DEFAULT_HOUSEHOLD_LOADER_CONFIG}.
 * @param metrics Optional observability sink (partial implementations allowed).
 * @param logger Optional logging sink (partial implementations allowed).
 */
export function createHouseholdLoader(
  cache: MembershipCache,
  deps: { source: MembershipSource },
  config: Partial<HouseholdLoaderConfig> = {},
  metrics: Partial<HouseholdLoaderMetrics> = {},
  logger: Partial<HouseholdLoaderLogger> = {}
): HouseholdLoader {
  const checkedCache = assertCache(cache);
  if (deps === null || typeof deps !== 'object') {
    throw new HouseholdLoaderError(
      HouseholdLoaderErrorCode.INVALID_CONFIG,
      'deps must be an object',
      { deps }
    );
  }
  const source = assertSource(deps.source);
  const cfg = validateHouseholdLoaderConfig(config);
  const m: HouseholdLoaderMetrics = { ...noopHouseholdLoaderMetrics, ...metrics };
  const l: HouseholdLoaderLogger = { ...noopHouseholdLoaderLogger, ...logger };

  function keyFor(userId: string, householdId: string): string {
    return makeMembershipKey(userId, householdId, cfg.keyNamespace);
  }

  async function load(userId: string, householdId: string): Promise<MembershipLookup> {
    const u = assertNonEmptyString(userId, HouseholdLoaderErrorCode.INVALID_USER, 'userId');
    const h = assertNonEmptyString(householdId, HouseholdLoaderErrorCode.INVALID_HOUSEHOLD, 'householdId');
    const key = keyFor(u, h);

    const cached = checkedCache.get(key);
    if (cached !== undefined) {
      m.recordCacheHit(u, h);
      l.debug('household membership cache hit', { userId: u, householdId: h, key });
      return freezeLookup({ ...cached, source: 'cache' });
    }
    m.recordCacheMiss(u, h);

    let raw: Membership | null;
    try {
      raw = await source.lookupMembership(u, h);
    } catch (error) {
      const code = HouseholdLoaderErrorCode.SOURCE_ERROR;
      m.recordSourceError(u, h, code);
      l.warn('household membership source lookup failed', {
        userId: u,
        householdId: h,
        message: error instanceof Error ? error.message : String(error),
      });
      throw new HouseholdLoaderError(
        code,
        'membership source lookup failed',
        { userId: u, householdId: h, cause: error }
      );
    }

    const membership = validateMembershipRecord(raw, u, h, source);
    const lookup: MembershipLookup = {
      userId: u,
      householdId: h,
      isMember: membership !== null,
      membership,
      checkedAtMs: cfg.nowMs(),
      source: 'source',
    };
    checkedCache.set(key, freezeLookup(lookup), cfg.ttlMs);
    m.recordSourceLookup(u, h, lookup.isMember);
    l.debug('household membership cached', {
      userId: u,
      householdId: h,
      isMember: lookup.isMember,
      key,
    });
    return freezeLookup(lookup);
  }

  function invalidate(userId: string, householdId: string): InvalidationResult {
    const u = assertNonEmptyString(userId, HouseholdLoaderErrorCode.INVALID_USER, 'userId');
    const h = assertNonEmptyString(householdId, HouseholdLoaderErrorCode.INVALID_HOUSEHOLD, 'householdId');
    const removed = checkedCache.delete(keyFor(u, h)) ? 1 : 0;
    const result: InvalidationResult = Object.freeze({ scope: 'membership', removed });
    m.recordInvalidation(result.scope, removed);
    return result;
  }

  function invalidateUser(userId: string): InvalidationResult {
    const u = assertNonEmptyString(userId, HouseholdLoaderErrorCode.INVALID_USER, 'userId');
    const removed = checkedCache.invalidateByPrefix(makeUserPrefix(u, cfg.keyNamespace));
    const result: InvalidationResult = Object.freeze({ scope: 'user', removed });
    m.recordInvalidation(result.scope, removed);
    l.debug('household membership user invalidated', { userId: u, removed });
    return result;
  }

  function invalidateAll(): InvalidationResult {
    const removed = checkedCache.clear();
    const result: InvalidationResult = Object.freeze({ scope: 'all', removed });
    m.recordInvalidation(result.scope, removed);
    l.debug('household membership cache fully invalidated', { removed });
    return result;
  }

  return Object.freeze({
    load,
    invalidate,
    invalidateUser,
    invalidateAll,
    keyFor,
    config: cfg,
  });
}
