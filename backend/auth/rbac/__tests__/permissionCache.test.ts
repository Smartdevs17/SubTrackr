// backend/auth/rbac/__tests__/permissionCache.test.ts
import { PermissionCache, DEFAULT_PERMISSION_CACHE_TTL_MS } from '../permissionCache';

describe('PermissionCache', () => {
  it('returns null on a miss', () => {
    const cache = new PermissionCache();
    expect(cache.get('user-1')).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('serves a stored permission list until it expires', () => {
    const cache = new PermissionCache(1_000);
    cache.set('user-1', ['invoice:read', 'invoice:write'], 100);

    expect(cache.get('user-1', 1_099)).toEqual(['invoice:read', 'invoice:write']);
    expect(cache.get('user-1', 1_100)).toBeNull();
    // The expired entry is removed, not just hidden.
    expect(cache.size).toBe(0);
  });

  it('distinguishes a cached empty list from a miss', () => {
    const cache = new PermissionCache();
    cache.set('user-1', []);

    expect(cache.get('user-1')).toEqual([]);
  });

  it('freezes the cached list so callers cannot mutate it', () => {
    const cache = new PermissionCache();
    const permissions = ['a', 'b'];
    cache.set('user-1', permissions);

    permissions.push('c');

    expect(cache.get('user-1')).toEqual(['a', 'b']);
    expect(Object.isFrozen(cache.get('user-1'))).toBe(true);
  });

  it('invalidates a single user without touching others', () => {
    const cache = new PermissionCache();
    cache.set('user-1', ['a']);
    cache.set('user-2', ['b']);

    cache.invalidate('user-1');

    expect(cache.get('user-1')).toBeNull();
    expect(cache.get('user-2')).toEqual(['b']);
  });

  it('clears every entry', () => {
    const cache = new PermissionCache();
    cache.set('user-1', ['a']);
    cache.set('user-2', ['b']);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get('user-2')).toBeNull();
  });

  it('uses a short default TTL so revocations cannot be hidden for long', () => {
    expect(DEFAULT_PERMISSION_CACHE_TTL_MS).toBeLessThanOrEqual(60_000);
  });
});
