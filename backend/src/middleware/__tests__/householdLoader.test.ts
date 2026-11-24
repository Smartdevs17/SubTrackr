/**
 * backend/src/middleware/__tests__/householdLoader.test.ts
 *
 * Unit tests for the household membership loader (issue #2264).
 * Covers deterministic keying, happy path, cache hit/negative caching, TTL
 * expiry, all invalidation scopes, source failures, malformed input and
 * observability hooks.
 */

import { createTtlCache } from '../../lib/cache';
import {
  HouseholdLoaderErrorCode,
  HouseholdLoaderError,
  DEFAULT_HOUSEHOLD_LOADER_CONFIG,
  noopHouseholdLoaderMetrics,
  noopHouseholdLoaderLogger,
  validateHouseholdLoaderConfig,
  makeMembershipKey,
  makeUserPrefix,
  createHouseholdLoader,
} from '../householdLoader';

function membership(userId: string, householdId: string, role: string = 'member') {
  return { userId, householdId, role, joinedAtMs: 100 };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected function to throw');
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

describe('error surface and constants', () => {
  it('exposes stable error codes', () => {
    expect(HouseholdLoaderErrorCode.INVALID_CONFIG).toBe('INVALID_CONFIG');
    expect(HouseholdLoaderErrorCode.INVALID_USER).toBe('INVALID_USER');
    expect(HouseholdLoaderErrorCode.INVALID_HOUSEHOLD).toBe('INVALID_HOUSEHOLD');
    expect(HouseholdLoaderErrorCode.INVALID_SOURCE).toBe('INVALID_SOURCE');
    expect(HouseholdLoaderErrorCode.SOURCE_ERROR).toBe('SOURCE_ERROR');
  });

  it('builds a typed HouseholdLoaderError', () => {
    const error = new HouseholdLoaderError(
      HouseholdLoaderErrorCode.SOURCE_ERROR,
      'failed',
      { userId: 'u' }
    );
    expect(error instanceof Error).toBe(true);
    expect(error instanceof HouseholdLoaderError).toBe(true);
    expect(error.name).toBe('HouseholdLoaderError');
    expect(error.code).toBe('SOURCE_ERROR');
    expect(error.details).toEqual({ userId: 'u' });
  });

  it('exposes frozen defaults and noop hooks', () => {
    expect(Object.isFrozen(DEFAULT_HOUSEHOLD_LOADER_CONFIG)).toBe(true);
    expect(DEFAULT_HOUSEHOLD_LOADER_CONFIG.ttlMs).toBe(30000);
    expect(typeof noopHouseholdLoaderMetrics.recordCacheHit).toBe('function');
    expect(typeof noopHouseholdLoaderLogger.warn).toBe('function');
  });
});

describe('config validation', () => {
  it('fills in defaults and honours overrides', () => {
    const config = validateHouseholdLoaderConfig({});
    expect(config.ttlMs).toBe(30000);
    expect(config.keyNamespace).toBe('hsmem');
    expect(Object.isFrozen(config)).toBe(true);

    const custom = validateHouseholdLoaderConfig({ ttlMs: 500, keyNamespace: 'x' });
    expect(custom.ttlMs).toBe(500);
    expect(custom.keyNamespace).toBe('x');
    expect(custom.nowMs()).toBeGreaterThan(0);
  });

  it('rejects invalid configuration', () => {
    expectCode(() => validateHouseholdLoaderConfig({ ttlMs: 0 }), 'INVALID_CONFIG');
    expectCode(() => validateHouseholdLoaderConfig({ ttlMs: NaN }), 'INVALID_CONFIG');
    expectCode(() => validateHouseholdLoaderConfig({ keyNamespace: '' }), 'INVALID_CONFIG');
    expectCode(() => validateHouseholdLoaderConfig(null), 'INVALID_CONFIG');
  });
});

describe('deterministic keying', () => {
  it('builds a stable, namespaced key', () => {
    expect(makeMembershipKey('u1', 'h1')).toBe('hsmem|u:u1|h:h1');
    expect(makeMembershipKey('u1', 'h1')).toBe(makeMembershipKey('u1', 'h1'));
    expect(makeMembershipKey('u1', 'h2')).not.toBe(makeMembershipKey('u1', 'h1'));
    expect(makeMembershipKey('u1', 'h1', 'custom')).toBe('custom|u:u1|h:h1');
  });

  it('percent-encodes delimiters so IDs cannot collide', () => {
    const a = makeMembershipKey('u|1', 'h');
    const b = makeMembershipKey('u', '1|h');
    expect(a).not.toBe(b);
    expect(a).toContain('%7C');
    expect(makeMembershipKey('a:b', 'h')).toContain('%3A');
    expect(makeMembershipKey('a%b', 'h')).toContain('%25');
  });

  it('builds a user prefix matching all households', () => {
    expect(makeUserPrefix('u1')).toBe('hsmem|u:u1|');
    expect(makeMembershipKey('u1', 'h1').startsWith(makeUserPrefix('u1'))).toBe(true);
  });

  it('rejects malformed key inputs', () => {
    expectCode(() => makeMembershipKey('', 'h1'), 'INVALID_USER');
    expectCode(() => makeMembershipKey('   ', 'h1'), 'INVALID_USER');
    expectCode(() => makeMembershipKey('u1', ''), 'INVALID_HOUSEHOLD');
    expectCode(() => makeUserPrefix(''), 'INVALID_USER');
  });
});

describe('load happy path', () => {
  it('calls the source once and caches a positive membership', async () => {
    const cache = createTtlCache();
    let calls = 0;
    const loader = createHouseholdLoader(cache, {
      source: {
        lookupMembership: (u, h) => {
          calls++;
          return membership(u, h);
        },
      },
    });

    const first = await loader.load('u1', 'h1');
    expect(first.isMember).toBe(true);
    expect(first.membership).not.toBeNull();
    expect(first.source).toBe('source');
    expect(first.userId).toBe('u1');
    expect(first.householdId).toBe('h1');
    expect(Object.isFrozen(first)).toBe(true);
    expect(calls).toBe(1);

    const second = await loader.load('u1', 'h1');
    expect(second.source).toBe('cache');
    expect(second.isMember).toBe(true);
    expect(calls).toBe(1);
  });

  it('supports async source resolvers', async () => {
    const loader = createHouseholdLoader(createTtlCache(), {
      source: {
        lookupMembership: async (u, h) => membership(u, h, 'admin'),
      },
    });
    const result = await loader.load('u1', 'h1');
    expect(result.membership?.role).toBe('admin');
  });

  it('caches negative lookups without a repeat source call', async () => {
    const cache = createTtlCache();
    let calls = 0;
    const loader = createHouseholdLoader(cache, {
      source: {
        lookupMembership: () => {
          calls++;
          return null;
        },
      },
    });
    const first = await loader.load('ghost', 'h1');
    expect(first.isMember).toBe(false);
    expect(first.membership).toBeNull();
    const second = await loader.load('ghost', 'h1');
    expect(second.isMember).toBe(false);
    expect(second.source).toBe('cache');
    expect(calls).toBe(1);
  });

  it('normalizes a malformed source record into a safe membership', async () => {
    const loader = createHouseholdLoader(createTtlCache(), {
      source: { lookupMembership: () => ({ role: 123, joinedAtMs: 'bad' }) },
    });
    const result = await loader.load('u1', 'h1');
    expect(result.isMember).toBe(true);
    expect(result.membership?.role).toBe('member');
    expect(result.membership?.joinedAtMs).toBe(0);
    expect(result.membership?.userId).toBe('u1');
  });

  it('rejects non-object source records', async () => {
    const loader = createHouseholdLoader(createTtlCache(), {
      source: { lookupMembership: () => 42 },
    });
    let caught: unknown;
    try {
      await loader.load('u1', 'h1');
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('SOURCE_ERROR');
  });
});

describe('TTL expiry through the loader', () => {
  it('re-queries the source after the configured TTL elapses', async () => {
    let clock = 0;
    let calls = 0;
    const cache = createTtlCache({ defaultTtlMs: 1000, nowMs: () => clock });
    const loader = createHouseholdLoader(
      cache,
      {
        source: {
          lookupMembership: (u, h) => {
            calls++;
            return membership(u, h);
          },
        },
      },
      { ttlMs: 50, nowMs: () => clock }
    );

    await loader.load('u1', 'h1');
    expect(calls).toBe(1);
    clock = 49;
    expect((await loader.load('u1', 'h1')).source).toBe('cache');
    clock = 50;
    expect((await loader.load('u1', 'h1')).source).toBe('source');
    expect(calls).toBe(2);
  });
});

describe('invalidation', () => {
  async function seededLoader() {
    let calls = 0;
    const loader = createHouseholdLoader(createTtlCache(), {
      source: {
        lookupMembership: (u, h) => {
          calls++;
          return membership(u, h);
        },
      },
    });
    await loader.load('u1', 'h1');
    await loader.load('u1', 'h2');
    await loader.load('u2', 'h1');
    return { loader, calls: () => calls };
  }

  it('invalidates a single membership pair', async () => {
    const { loader } = await seededLoader();
    const result = loader.invalidate('u1', 'h1');
    expect(result.scope).toBe('membership');
    expect(result.removed).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(loader.invalidate('nobody', 'h1').removed).toBe(0);
  });

  it('invalidates every household for one user', async () => {
    const { loader } = await seededLoader();
    const result = loader.invalidateUser('u1');
    expect(result.scope).toBe('user');
    expect(result.removed).toBe(2);
    await loader.load('u1', 'h1');
    await loader.load('u1', 'h2');
    await loader.load('u2', 'h1');
    expect((await loader.load('u1', 'h1')).source).toBe('cache');
  });

  it('invalidates the entire cache', async () => {
    const { loader } = await seededLoader();
    const result = loader.invalidateAll();
    expect(result.scope).toBe('all');
    expect(result.removed).toBe(3);
  });

  it('rejects malformed invalidation input', async () => {
    const { loader } = await seededLoader();
    expectCode(() => loader.invalidate('', 'h1'), 'INVALID_USER');
    expectCode(() => loader.invalidate('u1', ''), 'INVALID_HOUSEHOLD');
    expectCode(() => loader.invalidateUser('  '), 'INVALID_USER');
  });
});

describe('dependency validation and failures', () => {
  it('rejects a missing or malformed source', () => {
    expectCode(
      () => createHouseholdLoader(createTtlCache(), { source: {} as never }),
      'INVALID_SOURCE'
    );
    expectCode(
      () => createHouseholdLoader(createTtlCache(), null as never),
      'INVALID_CONFIG'
    );
  });

  it('rejects a cache that does not implement the contract', () => {
    expectCode(
      () => createHouseholdLoader({} as never, { source: { lookupMembership: () => null } }),
      'INVALID_CONFIG'
    );
  });

  it('surfaces source exceptions as typed SOURCE_ERROR', async () => {
    let caught: unknown;
    const loader = createHouseholdLoader(createTtlCache(), {
      source: {
        lookupMembership: () => {
          throw new Error('db down');
        },
      },
    });
    try {
      await loader.load('u1', 'h1');
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('SOURCE_ERROR');
    expect((caught as { name?: string }).name).toBe('HouseholdLoaderError');
  });

  it('rejects malformed load input', async () => {
    const loader = createHouseholdLoader(createTtlCache(), {
      source: { lookupMembership: () => null },
    });
    let a: unknown;
    let b: unknown;
    try { await loader.load('', 'h1'); } catch (e) { a = e; }
    try { await loader.load('u1', ''); } catch (e) { b = e; }
    expect((a as { code?: string }).code).toBe('INVALID_USER');
    expect((b as { code?: string }).code).toBe('INVALID_HOUSEHOLD');
  });
});

describe('observability hooks', () => {
  it('emits metrics and logs for hits, misses, lookups and invalidations', async () => {
    const events: string[] = [];
    const warnings: string[] = [];
    let calls = 0;
    const loader = createHouseholdLoader(
      createTtlCache(),
      {
        source: {
          lookupMembership: (u, h) => {
            calls++;
            if (calls === 2) throw new Error('boom');
            return membership(u, h);
          },
        },
      },
      {},
      {
        recordCacheHit: () => { events.push('hit'); },
        recordCacheMiss: () => { events.push('miss'); },
        recordSourceLookup: () => { events.push('lookup'); },
        recordInvalidation: () => { events.push('invalidate'); },
        recordSourceError: () => { events.push('error'); },
      },
      {
        debug: () => {},
        warn: (message) => { warnings.push(message); },
      }
    );

    await loader.load('u1', 'h1');
    await loader.load('u1', 'h1');
    loader.invalidateUser('u1');
    expect(events).toContain('miss');
    expect(events).toContain('lookup');
    expect(events).toContain('hit');
    expect(events).toContain('invalidate');

    try {
      await loader.load('bad', 'h1');
    } catch (e) {
      void e;
    }
    expect(events).toContain('error');
    expect(warnings.length).toBeGreaterThan(0);
  });
});
