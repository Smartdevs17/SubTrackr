/**
 * SubscriptionCacheService
 *
 * Redis-backed cache for subscription data using a write-through pattern.
 *
 * Read path:   Redis → (on miss) database callback
 * Write path:  database callback → Redis (written together; cache always
 *              reflects persisted state)
 *
 * Guarantees:
 *  - Stale reads are bounded by TTL (default 5 min)
 *  - Cache is invalidated synchronously on state changes before the
 *    write resolves, preventing dirty reads during rapid updates
 *  - All Redis errors fall through to the database; the service never
 *    throws due to cache unavailability
 *  - Hit-ratio and operation counters are exposed for monitoring
 */

import type { Subscription } from '../../src/types/subscription';

// ── Serialization ─────────────────────────────────────────────────────────────
// JSON.stringify converts Date objects to ISO 8601 strings.  Without a reviver,
// JSON.parse hands back strings, breaking strict-equality checks and any code
// that calls .getTime() on those fields.  We restore Date fields explicitly.

const DATE_FIELDS: ReadonlyArray<keyof Subscription> = [
  'nextBillingDate',
  'createdAt',
  'updatedAt',
  'fiatPriceUpdatedAt',
];

function reviveSub(raw: unknown): Subscription {
  const sub = raw as Record<string, unknown>;
  for (const field of DATE_FIELDS) {
    if (typeof sub[field] === 'string') {
      sub[field] = new Date(sub[field] as string);
    }
  }
  return sub as unknown as Subscription;
}

function reviveSubList(raw: unknown): Subscription[] {
  return (raw as unknown[]).map(reviveSub);
}

// ── Redis client interface ────────────────────────────────────────────────────
// We program against a minimal interface rather than a concrete Redis client so
// that callers can pass `ioredis`, `redis` (node-redis), or a test double.

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: 'EX', time: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

// ── Configuration ─────────────────────────────────────────────────────────────

export interface SubscriptionCacheConfig {
  /** TTL for individual subscription entries. Default: 300 s (5 min). */
  subscriptionTtlSeconds?: number;
  /** TTL for the user-level subscription list. Default: 120 s (2 min). */
  listTtlSeconds?: number;
  /** Redis key prefix. Default: 'subtrackr:sub:'. */
  keyPrefix?: string;
}

const DEFAULTS = {
  subscriptionTtlSeconds: 300,
  listTtlSeconds: 120,
  keyPrefix: 'subtrackr:sub:',
} as const;

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface CacheMetrics {
  hits: number;
  misses: number;
  writes: number;
  invalidations: number;
  errors: number;
  /** hits / (hits + misses). NaN when no reads yet. */
  hitRatio: number;
}

// ── Key schema ────────────────────────────────────────────────────────────────
//
//   subtrackr:sub:id:<subscriptionId>       → Subscription JSON
//   subtrackr:sub:user:<userId>             → Subscription[] JSON
//   subtrackr:sub:all                       → Subscription[] JSON (full list)

// ── Service ───────────────────────────────────────────────────────────────────

export class SubscriptionCacheService {
  private readonly ttl: number;
  private readonly listTtl: number;
  private readonly prefix: string;

  private hits = 0;
  private misses = 0;
  private writes = 0;
  private invalidations = 0;
  private errors = 0;

  constructor(
    private readonly redis: RedisClient,
    config: SubscriptionCacheConfig = {},
  ) {
    this.ttl = config.subscriptionTtlSeconds ?? DEFAULTS.subscriptionTtlSeconds;
    this.listTtl = config.listTtlSeconds ?? DEFAULTS.listTtlSeconds;
    this.prefix = config.keyPrefix ?? DEFAULTS.keyPrefix;
  }

  // ── Key helpers ─────────────────────────────────────────────────────────────

  private idKey(subscriptionId: string): string {
    return `${this.prefix}id:${subscriptionId}`;
  }

  private userKey(userId: string): string {
    return `${this.prefix}user:${userId}`;
  }

  private allKey(): string {
    return `${this.prefix}all`;
  }

  // ── Core read: single subscription ─────────────────────────────────────────

  /**
   * Returns a subscription by ID.
   *
   * Cache hit  → returns cached value.
   * Cache miss → calls `dbFetch`, writes result through to Redis, returns it.
   * Redis error → logs error counter, falls through to `dbFetch` directly.
   */
  async getById(
    subscriptionId: string,
    dbFetch: (id: string) => Promise<Subscription | null>,
  ): Promise<Subscription | null> {
    const key = this.idKey(subscriptionId);

    try {
      const cached = await this.redis.get(key);
      if (cached !== null) {
        this.hits++;
        return reviveSub(JSON.parse(cached));
      }
    } catch (err) {
      this.errors++;
      // Fall through to database
    }

    this.misses++;
    const sub = await dbFetch(subscriptionId);
    if (sub !== null) {
      await this.setOne(sub);
    }
    return sub;
  }

  /**
   * Returns all subscriptions for a user.
   *
   * Cache hit  → returns cached list.
   * Cache miss → calls `dbFetch`, writes result through, returns it.
   */
  async getByUserId(
    userId: string,
    dbFetch: (userId: string) => Promise<Subscription[]>,
  ): Promise<Subscription[]> {
    const key = this.userKey(userId);

    try {
      const cached = await this.redis.get(key);
      if (cached !== null) {
        this.hits++;
        return reviveSubList(JSON.parse(cached));
      }
    } catch (err) {
      this.errors++;
    }

    this.misses++;
    const subs = await dbFetch(userId);
    await this.setUserList(userId, subs);
    return subs;
  }

  /**
   * Returns all subscriptions (global list).
   */
  async getAll(dbFetch: () => Promise<Subscription[]>): Promise<Subscription[]> {
    const key = this.allKey();

    try {
      const cached = await this.redis.get(key);
      if (cached !== null) {
        this.hits++;
        return reviveSubList(JSON.parse(cached));
      }
    } catch (err) {
      this.errors++;
    }

    this.misses++;
    const subs = await dbFetch();
    await this.setAllList(subs);
    return subs;
  }

  // ── Write-through helpers ───────────────────────────────────────────────────

  /**
   * Write-through: persists to the database first, then updates the cache.
   *
   * On Redis error the write is still considered successful — the database
   * is the source of truth. The cache entry will be refreshed on the next read.
   *
   * The caller's `userId` is required to invalidate the per-user list and
   * prevent stale list entries after a write.
   */
  async writeThrough(
    subscription: Subscription,
    userId: string,
    dbWrite: (sub: Subscription) => Promise<Subscription>,
  ): Promise<Subscription> {
    // 1. Persist to database first
    const persisted = await dbWrite(subscription);

    // 2. Update individual entry cache
    await this.setOne(persisted);

    // 3. Invalidate aggregated lists (they are now stale)
    await this.invalidateUserList(userId);
    await this.invalidateAllList();

    return persisted;
  }

  /**
   * Write-through delete: removes from database then evicts from cache.
   */
  async writeDelete(
    subscriptionId: string,
    userId: string,
    dbDelete: (id: string) => Promise<void>,
  ): Promise<void> {
    await dbDelete(subscriptionId);
    await this.invalidate(subscriptionId, userId);
  }

  // ── Low-level cache setters ─────────────────────────────────────────────────

  private async setOne(sub: Subscription): Promise<void> {
    try {
      await this.redis.set(this.idKey(sub.id), JSON.stringify(sub), 'EX', this.ttl);
      this.writes++;
    } catch (err) {
      this.errors++;
    }
  }

  private async setUserList(userId: string, subs: Subscription[]): Promise<void> {
    try {
      await this.redis.set(this.userKey(userId), JSON.stringify(subs), 'EX', this.listTtl);
      this.writes++;
    } catch (err) {
      this.errors++;
    }
  }

  private async setAllList(subs: Subscription[]): Promise<void> {
    try {
      await this.redis.set(this.allKey(), JSON.stringify(subs), 'EX', this.listTtl);
      this.writes++;
    } catch (err) {
      this.errors++;
    }
  }

  // ── Invalidation ────────────────────────────────────────────────────────────

  /**
   * Invalidates a single subscription entry and the per-user and global lists.
   * Call this on any subscription state change (cancel, pause, upgrade, etc.).
   */
  async invalidate(subscriptionId: string, userId: string): Promise<void> {
    const keys: string[] = [
      this.idKey(subscriptionId),
      this.userKey(userId),
      this.allKey(),
    ];

    try {
      await this.redis.del(...keys);
      this.invalidations += keys.length;
    } catch (err) {
      this.errors++;
    }
  }

  private async invalidateUserList(userId: string): Promise<void> {
    try {
      await this.redis.del(this.userKey(userId));
      this.invalidations++;
    } catch (err) {
      this.errors++;
    }
  }

  private async invalidateAllList(): Promise<void> {
    try {
      await this.redis.del(this.allKey());
      this.invalidations++;
    } catch (err) {
      this.errors++;
    }
  }

  /**
   * Invalidates all subscription cache entries under this service's prefix.
   * Use with care — results in a full cold-start until the cache re-warms.
   */
  async invalidateAll(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.prefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.invalidations += keys.length;
      }
    } catch (err) {
      this.errors++;
    }
  }

  // ── Cache warming ────────────────────────────────────────────────────────────

  /**
   * Warms the cache on application startup.
   *
   * Fetches all subscriptions from the database and writes them to Redis so
   * the first wave of real requests gets cache hits rather than cold misses.
   *
   * If Redis is unavailable the warm-up fails silently — the app continues
   * to function via the database fallback.
   *
   * @param dbFetchAll - Returns every subscription from the database.
   * @param getUserId  - Derives the owning userId from a subscription.
   */
  async warmUp(
    dbFetchAll: () => Promise<Subscription[]>,
    getUserId: (sub: Subscription) => string,
  ): Promise<{ warmed: number; errors: number }> {
    let warmed = 0;
    let errorCount = 0;

    // Verify Redis is reachable before attempting bulk write
    try {
      await this.redis.ping();
    } catch {
      return { warmed: 0, errors: 1 };
    }

    let subs: Subscription[];
    try {
      subs = await dbFetchAll();
    } catch {
      return { warmed: 0, errors: 1 };
    }

    // Write individual entries
    for (const sub of subs) {
      try {
        await this.redis.set(this.idKey(sub.id), JSON.stringify(sub), 'EX', this.ttl);
        this.writes++;
        warmed++;
      } catch {
        this.errors++;
        errorCount++;
      }
    }

    // Write per-user lists
    const byUser = new Map<string, Subscription[]>();
    for (const sub of subs) {
      const uid = getUserId(sub);
      const list = byUser.get(uid) ?? [];
      list.push(sub);
      byUser.set(uid, list);
    }
    for (const [uid, list] of byUser) {
      try {
        await this.redis.set(this.userKey(uid), JSON.stringify(list), 'EX', this.listTtl);
        this.writes++;
        warmed++;
      } catch {
        this.errors++;
        errorCount++;
      }
    }

    // Write global list
    try {
      await this.redis.set(this.allKey(), JSON.stringify(subs), 'EX', this.listTtl);
      this.writes++;
      warmed++;
    } catch {
      this.errors++;
      errorCount++;
    }

    return { warmed, errors: errorCount };
  }

  // ── Metrics ─────────────────────────────────────────────────────────────────

  getMetrics(): CacheMetrics {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      writes: this.writes,
      invalidations: this.invalidations,
      errors: this.errors,
      hitRatio: total === 0 ? NaN : this.hits / total,
    };
  }

  resetMetrics(): void {
    this.hits = 0;
    this.misses = 0;
    this.writes = 0;
    this.invalidations = 0;
    this.errors = 0;
  }

  // ── Health check ─────────────────────────────────────────────────────────────

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.redis.ping();
      return response === 'PONG';
    } catch {
      return false;
    }
  }
}