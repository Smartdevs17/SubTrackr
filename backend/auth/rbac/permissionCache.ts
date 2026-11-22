// backend/auth/rbac/permissionCache.ts
/**
 * Bounded TTL cache for a user's resolved permission set.
 *
 * `PermissionGuard` runs on every guarded request and previously issued two
 * database round-trips per request (a role/permission join plus the audit-log
 * write). Role assignments change rarely relative to request volume, so the
 * resolved permission list is memoised for a short window.
 *
 * Correctness rules:
 *  - The cache is write-through and never authoritative: a miss always falls
 *    back to the database.
 *  - Every role mutation (`RoleService`) invalidates the affected users, so a
 *    grant or revoke takes effect immediately.
 *  - The TTL is the safety net for any mutation path that forgets to
 *    invalidate; keep it small enough for the security posture you need.
 */

export const DEFAULT_PERMISSION_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  permissions: string[];
  expiresAt: number;
}

export class PermissionCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs: number = DEFAULT_PERMISSION_CACHE_TTL_MS) {}

  /** Returns the cached permission list, or `null` on a miss or expiry. */
  get(userId: string, now: number = Date.now()): string[] | null {
    const entry = this.entries.get(userId);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(userId);
      return null;
    }
    return entry.permissions;
  }

  set(userId: string, permissions: string[], now: number = Date.now()): void {
    // Freeze a copy so callers can never mutate the cached list in place.
    this.entries.set(userId, {
      permissions: Object.freeze([...permissions]),
      expiresAt: now + this.ttlMs,
    });
  }

  /** Drop one user's entry (call after any role assignment change). */
  invalidate(userId: string): void {
    this.entries.delete(userId);
  }

  /** Drop everything (call after destructive role/permission mutations). */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Process-wide cache used by the guard and invalidated by role mutations. */
export const permissionCache = new PermissionCache();
