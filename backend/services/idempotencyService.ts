import { randomUUID } from 'crypto';

// ── Constants ────────────────────────────────────────────────────────────────

const WINDOW_MS = 24 * 60 * 60 * 1_000; // 24 hours
const MAX_KEYS = 100_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000; // run cleanup every hour

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

// ── Types ────────────────────────────────────────────────────────────────────

export type IdempotencyStatus = 'pending' | 'completed' | 'failed';

export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  status: IdempotencyStatus;
  response: unknown | null;
  createdAt: number;
  completedAt: number | null;
}

export interface IdempotencyResult<T> {
  cached: boolean;
  response: T;
}

export class IdempotencyKeyCollisionError extends Error {
  constructor(key: string) {
    super(
      `Idempotency key "${key}" was already used with a different request payload. ` +
        `Use a new key for a different operation.`,
    );
    this.name = 'IdempotencyKeyCollisionError';
  }
}

export class IdempotencyRequestInFlightError extends Error {
  constructor(key: string) {
    super(
      `A request with idempotency key "${key}" is already in progress. ` +
        `Retry after the original request completes.`,
    );
    this.name = 'IdempotencyRequestInFlightError';
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export class IdempotencyService {
  private store = new Map<string, IdempotencyRecord>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly windowMs = WINDOW_MS) {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Allow the process to exit even if this timer is still running
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /**
   * Execute a payment operation with idempotency guarantees.
   *
   * - First call: runs `operation`, stores the result, returns it.
   * - Repeat call with same key + same payload: returns cached result immediately.
   * - Repeat call with same key + different payload: throws IdempotencyKeyCollisionError.
   * - Call while original is still in-flight: throws IdempotencyRequestInFlightError.
   * - Failed operations: NOT cached — the key is freed so the client can retry.
   */
  async execute<T>(
    key: string,
    requestHash: string,
    operation: () => Promise<T>,
  ): Promise<IdempotencyResult<T>> {
    this.enforceStorageLimit();

    const existing = this.store.get(key);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyKeyCollisionError(key);
      }

      if (existing.status === 'pending') {
        throw new IdempotencyRequestInFlightError(key);
      }

      // completed — return cached response
      if (existing.status === 'completed') {
        return { cached: true, response: existing.response as T };
      }

      // failed — remove so the client can retry with the same key
      this.store.delete(key);
    }

    // Mark as in-flight
    const record: IdempotencyRecord = {
      key,
      requestHash,
      status: 'pending',
      response: null,
      createdAt: Date.now(),
      completedAt: null,
    };
    this.store.set(key, record);

    try {
      const response = await operation();
      record.status = 'completed';
      record.response = response;
      record.completedAt = Date.now();
      return { cached: false, response };
    } catch (err) {
      // Don't cache failures — client should be able to retry with the same key
      record.status = 'failed';
      this.store.delete(key);
      throw err;
    }
  }

  /** Look up a record without executing anything. */
  get(key: string): IdempotencyRecord | undefined {
    return this.store.get(key);
  }

  /** Explicitly remove a key (e.g. for testing or admin tooling). */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** Register a key as pending. Used by middleware before the handler runs. */
  registerPending(key: string, requestHash: string): void {
    this.enforceStorageLimit();
    this.store.set(key, {
      key,
      requestHash,
      status: 'pending',
      response: null,
      createdAt: Date.now(),
      completedAt: null,
    });
  }

  /** Mark a pending key as completed with its response. */
  complete(key: string, response: unknown): void {
    const record = this.store.get(key);
    if (record && record.status === 'pending') {
      record.status = 'completed';
      record.response = response;
      record.completedAt = Date.now();
    }
  }

  /** Remove all expired records. Called automatically on a timer. */
  cleanup(): number {
    const cutoff = Date.now() - this.windowMs;
    let removed = 0;
    for (const [key, record] of this.store) {
      if (record.createdAt < cutoff) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.store.size;
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private enforceStorageLimit(): void {
    if (this.store.size >= MAX_KEYS) {
      // Evict the oldest 10% to stay under the limit
      const evictCount = Math.floor(MAX_KEYS * 0.1);
      let evicted = 0;
      for (const key of this.store.keys()) {
        if (evicted >= evictCount) break;
        this.store.delete(key);
        evicted++;
      }
    }
  }
}

export const idempotencyService = new IdempotencyService();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a stable hash from a request body to detect key collisions.
 * Uses a simple deterministic JSON stringify — good enough for payment payloads.
 */
export function hashRequest(body: unknown): string {
  const canonical = JSON.stringify(body, Object.keys(body as object).sort());
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    hash = (Math.imul(31, hash) + canonical.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}

/**
 * Generate a new idempotency key. Clients can use this if they don't supply one.
 */
export function generateIdempotencyKey(): string {
  return randomUUID();
}
