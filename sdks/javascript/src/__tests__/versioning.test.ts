/**
 * versioning.test.ts
 *
 * Issue #1178 — Implement SDK versioning with deprecation policy
 *
 * Test suites:
 *   1. version.ts — assessApiVersionCompatibility
 *   2. version.ts — parseSemVer, compareSemVer, satisfiesMinVersion
 *   3. deprecation.ts — DeprecationRegistry
 *   4. deprecation.ts — warnDeprecated (console.warn capture)
 *   5. deprecation.ts — throwIfRemoved / RemovedError
 *   6. deprecation.ts — withDeprecationWarning higher-order function
 *   7. errors.ts      — UnsupportedVersionError / VersionMismatchError
 *   8. client.ts      — constructor rejects unsupported API version
 *   9. client.ts      — getSubscriptions() deprecation warning
 *  10. client.ts      — getWebhooks() deprecation warning
 *  11. client.ts      — getSdkVersion() / getApiVersion()
 *  12. client.ts      — X-SDK-Version header injected on requests
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import {
  SDK_VERSION,
  CURRENT_API_VERSION,
  MIN_SUPPORTED_API_VERSION,
  assessApiVersionCompatibility,
  parseSemVer,
  compareSemVer,
  satisfiesMinVersion,
} from '../version';

import {
  RemovedError,
  DeprecationRegistry,
  warnDeprecated,
  throwIfRemoved,
  withDeprecationWarning,
} from '../deprecation';

import { UnsupportedVersionError, VersionMismatchError } from '../errors';

import { SubTrackrClient } from '../client';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeClient(overrides: Record<string, unknown> = {}): SubTrackrClient {
  return new SubTrackrClient({
    apiKey: 'sk_test_123',
    environment: 'sandbox',
    ...overrides,
  });
}

/** Capture console.warn calls without polluting test output. */
function captureWarn(): { calls: string[][]; restore: () => void } {
  const calls: string[][] = [];
  const spy = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    calls.push(args.map(String));
  });
  return { calls, restore: () => spy.mockRestore() };
}

// ═════════════════════════════════════════════════════════════════════════════
// Suite 1 — assessApiVersionCompatibility
// ═════════════════════════════════════════════════════════════════════════════
describe('version: assessApiVersionCompatibility', () => {
  it('current API version is fully supported', () => {
    const r = assessApiVersionCompatibility(CURRENT_API_VERSION);
    expect(r.supported).toBe(true);
    expect(r.deprecated).toBe(false);
    expect(r.removed).toBe(false);
    expect(r.message).toBeUndefined();
  });

  it('minimum supported version is deprecated but not removed', () => {
    if (MIN_SUPPORTED_API_VERSION < CURRENT_API_VERSION) {
      const r = assessApiVersionCompatibility(MIN_SUPPORTED_API_VERSION);
      expect(r.deprecated).toBe(true);
      expect(r.removed).toBe(false);
      expect(r.message).toBeDefined();
    }
  });

  it('a version below minimum is deprecated with a message', () => {
    const r = assessApiVersionCompatibility(MIN_SUPPORTED_API_VERSION - 1);
    expect(r.deprecated).toBe(true);
    expect(r.supported).toBe(false);
    expect(r.message).toMatch(/deprecated/i);
  });

  it('a future version is flagged as unsupported (not removed)', () => {
    const r = assessApiVersionCompatibility(CURRENT_API_VERSION + 10);
    expect(r.supported).toBe(false);
    expect(r.removed).toBe(false);
    expect(r.message).toMatch(/newer/i);
  });

  it('SDK_VERSION constant is a valid semver string', () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 2 — parseSemVer / compareSemVer / satisfiesMinVersion
// ═════════════════════════════════════════════════════════════════════════════
describe('version: semver utilities', () => {
  it('parseSemVer correctly splits "2.1.3"', () => {
    expect(parseSemVer('2.1.3')).toEqual({ major: 2, minor: 1, patch: 3 });
  });

  it('parseSemVer correctly splits "0.0.1"', () => {
    expect(parseSemVer('0.0.1')).toEqual({ major: 0, minor: 0, patch: 1 });
  });

  it('parseSemVer throws on invalid format', () => {
    expect(() => parseSemVer('1.2')).toThrow();
    expect(() => parseSemVer('a.b.c')).toThrow();
    expect(() => parseSemVer('1.2.3.4')).toThrow();
  });

  it('compareSemVer returns 0 for equal versions', () => {
    expect(compareSemVer({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 3 })).toBe(0);
  });

  it('compareSemVer returns negative when a < b (major)', () => {
    expect(compareSemVer({ major: 1, minor: 0, patch: 0 }, { major: 2, minor: 0, patch: 0 })).toBeLessThan(0);
  });

  it('compareSemVer returns positive when a > b (minor)', () => {
    expect(compareSemVer({ major: 1, minor: 5, patch: 0 }, { major: 1, minor: 2, patch: 0 })).toBeGreaterThan(0);
  });

  it('compareSemVer uses patch when major+minor are equal', () => {
    expect(compareSemVer({ major: 1, minor: 1, patch: 5 }, { major: 1, minor: 1, patch: 2 })).toBeGreaterThan(0);
  });

  it('satisfiesMinVersion returns true when current >= minimum', () => {
    expect(satisfiesMinVersion('2.1.0', '2.0.0')).toBe(true);
    expect(satisfiesMinVersion('2.0.0', '2.0.0')).toBe(true);
    expect(satisfiesMinVersion('3.0.0', '2.0.0')).toBe(true);
  });

  it('satisfiesMinVersion returns false when current < minimum', () => {
    expect(satisfiesMinVersion('1.9.9', '2.0.0')).toBe(false);
    expect(satisfiesMinVersion('2.0.0', '2.0.1')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 3 — DeprecationRegistry
// ═════════════════════════════════════════════════════════════════════════════
describe('deprecation: DeprecationRegistry', () => {
  beforeEach(() => DeprecationRegistry.reset());

  it('hasWarned returns false before first warning', () => {
    expect(DeprecationRegistry.hasWarned('someMethod')).toBe(false);
  });

  it('markWarned then hasWarned returns true', () => {
    DeprecationRegistry.markWarned('someMethod');
    expect(DeprecationRegistry.hasWarned('someMethod')).toBe(true);
  });

  it('reset clears all warned entries', () => {
    DeprecationRegistry.markWarned('a');
    DeprecationRegistry.markWarned('b');
    DeprecationRegistry.reset();
    expect(DeprecationRegistry.hasWarned('a')).toBe(false);
    expect(DeprecationRegistry.hasWarned('b')).toBe(false);
  });

  it('silence suppresses output, unsilence restores it', () => {
    DeprecationRegistry.silence();
    expect(DeprecationRegistry.silenced).toBe(true);
    DeprecationRegistry.unsilence();
    expect(DeprecationRegistry.silenced).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 4 — warnDeprecated
// ═════════════════════════════════════════════════════════════════════════════
describe('deprecation: warnDeprecated', () => {
  beforeEach(() => {
    DeprecationRegistry.reset();
    DeprecationRegistry.unsilence();
  });

  it('emits console.warn on first call', () => {
    const { calls, restore } = captureWarn();
    warnDeprecated({ method: 'foo', deprecatedIn: '1.0.0', removedIn: '2.0.0' });
    restore();
    expect(calls).toHaveLength(1);
    expect(calls[0].join(' ')).toContain('foo');
    expect(calls[0].join(' ')).toContain('1.0.0');
    expect(calls[0].join(' ')).toContain('2.0.0');
  });

  it('does NOT emit console.warn on subsequent calls (deduplication)', () => {
    const { calls, restore } = captureWarn();
    warnDeprecated({ method: 'bar', deprecatedIn: '1.0.0', removedIn: '2.0.0' });
    warnDeprecated({ method: 'bar', deprecatedIn: '1.0.0', removedIn: '2.0.0' });
    warnDeprecated({ method: 'bar', deprecatedIn: '1.0.0', removedIn: '2.0.0' });
    restore();
    expect(calls).toHaveLength(1);
  });

  it('includes replacement in the warning message when provided', () => {
    const { calls, restore } = captureWarn();
    warnDeprecated({
      method: 'getSubscriptions',
      deprecatedIn: '2.0.0',
      removedIn: '3.0.0',
      replacement: 'listSubscriptions()',
    });
    restore();
    expect(calls[0].join(' ')).toContain('listSubscriptions()');
  });

  it('includes custom note in the warning message when provided', () => {
    const { calls, restore } = captureWarn();
    warnDeprecated({
      method: 'getSubscriptions',
      deprecatedIn: '2.0.0',
      removedIn: '3.0.0',
      note: 'See migration guide at https://docs.subtrackr.io',
    });
    restore();
    expect(calls[0].join(' ')).toContain('migration guide');
  });

  it('does not emit when DeprecationRegistry is silenced', () => {
    DeprecationRegistry.silence();
    const { calls, restore } = captureWarn();
    warnDeprecated({ method: 'silenced_method', deprecatedIn: '1.0.0', removedIn: '2.0.0' });
    restore();
    expect(calls).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 5 — throwIfRemoved / RemovedError
// ═════════════════════════════════════════════════════════════════════════════
describe('deprecation: throwIfRemoved / RemovedError', () => {
  it('throwIfRemoved throws a RemovedError', () => {
    expect(() =>
      throwIfRemoved({ method: 'legacyCreate', removedIn: '2.0.0', replacement: 'createPlan()' })
    ).toThrow(RemovedError);
  });

  it('RemovedError.message contains method name, version, and replacement', () => {
    let err: RemovedError | null = null;
    try {
      throwIfRemoved({ method: 'legacyCreate', removedIn: '2.0.0', replacement: 'createPlan()' });
    } catch (e) {
      err = e as RemovedError;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain('legacyCreate');
    expect(err!.message).toContain('2.0.0');
    expect(err!.message).toContain('createPlan()');
  });

  it('RemovedError.name is "RemovedError"', () => {
    let err: Error | null = null;
    try {
      throwIfRemoved({ method: 'x', removedIn: '1.0.0' });
    } catch (e) {
      err = e as Error;
    }
    expect(err?.name).toBe('RemovedError');
  });

  it('RemovedError exposes method and removedIn properties', () => {
    let err: RemovedError | null = null;
    try {
      throwIfRemoved({ method: 'oldApi', removedIn: '3.0.0' });
    } catch (e) {
      err = e as RemovedError;
    }
    expect(err?.method).toBe('oldApi');
    expect(err?.removedIn).toBe('3.0.0');
  });

  it('RemovedError without replacement still has a meaningful message', () => {
    let err: RemovedError | null = null;
    try {
      throwIfRemoved({ method: 'noReplacement', removedIn: '2.0.0' });
    } catch (e) {
      err = e as RemovedError;
    }
    expect(err!.message).toContain('noReplacement');
    expect(err!.message).toContain('migration guide');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 6 — withDeprecationWarning
// ═════════════════════════════════════════════════════════════════════════════
describe('deprecation: withDeprecationWarning HOF', () => {
  beforeEach(() => {
    DeprecationRegistry.reset();
    DeprecationRegistry.unsilence();
  });

  it('calls the original function and returns its result', async () => {
    const original = async function getData() {
      return 42;
    };
    const wrapped = withDeprecationWarning(original, {
      deprecatedIn: '1.0.0',
      removedIn: '2.0.0',
    });
    const { calls, restore } = captureWarn();
    const result = await wrapped();
    restore();
    expect(result).toBe(42);
    expect(calls).toHaveLength(1);
  });

  it('preserves the original function name', () => {
    const original = function myOldFunction() {
      return 0;
    };
    const wrapped = withDeprecationWarning(original, {
      deprecatedIn: '1.0.0',
      removedIn: '2.0.0',
    });
    expect(wrapped.name).toBe('myOldFunction');
  });

  it('only warns once across multiple invocations', () => {
    const fn = function multiCall() {
      return null;
    };
    const wrapped = withDeprecationWarning(fn, {
      deprecatedIn: '1.0.0',
      removedIn: '2.0.0',
    });
    const { calls, restore } = captureWarn();
    wrapped();
    wrapped();
    wrapped();
    restore();
    expect(calls).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 7 — UnsupportedVersionError / VersionMismatchError
// ═════════════════════════════════════════════════════════════════════════════
describe('errors: versioning error types', () => {
  it('UnsupportedVersionError.name is "UnsupportedVersionError"', () => {
    const err = new UnsupportedVersionError(0, 1);
    expect(err.name).toBe('UnsupportedVersionError');
  });

  it('UnsupportedVersionError.message contains version numbers', () => {
    const err = new UnsupportedVersionError(0, 1);
    expect(err.message).toContain('0');
    expect(err.message).toContain('1');
  });

  it('UnsupportedVersionError exposes requestedVersion and minSupportedVersion', () => {
    const err = new UnsupportedVersionError(0, 1);
    expect(err.requestedVersion).toBe(0);
    expect(err.minSupportedVersion).toBe(1);
  });

  it('VersionMismatchError.name is "VersionMismatchError"', () => {
    const err = new VersionMismatchError('2.0.0', 99);
    expect(err.name).toBe('VersionMismatchError');
  });

  it('VersionMismatchError.message defaults to a helpful description', () => {
    const err = new VersionMismatchError('2.0.0', 99);
    expect(err.message).toMatch(/mismatch|99|2\.0\.0/i);
  });

  it('VersionMismatchError accepts a custom detail message', () => {
    const err = new VersionMismatchError('2.0.0', 99, 'Custom detail');
    expect(err.message).toBe('Custom detail');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 8 — SubTrackrClient constructor version validation
// ═════════════════════════════════════════════════════════════════════════════
describe('client: constructor version validation', () => {
  it('accepts the current API version without error', () => {
    expect(() => makeClient({ apiVersion: CURRENT_API_VERSION })).not.toThrow();
  });

  it('rejects an API version below the minimum', () => {
    expect(() => makeClient({ apiVersion: MIN_SUPPORTED_API_VERSION - 1 })).toThrow(
      UnsupportedVersionError
    );
  });

  it('accepts no apiVersion option (defaults to CURRENT_API_VERSION)', () => {
    const client = makeClient();
    expect(client.getApiVersion()).toBe(CURRENT_API_VERSION);
  });

  it('exposes the configured apiVersion via getApiVersion()', () => {
    const client = makeClient({ apiVersion: CURRENT_API_VERSION });
    expect(client.getApiVersion()).toBe(CURRENT_API_VERSION);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 9 — getSubscriptions() deprecation warning
// ═════════════════════════════════════════════════════════════════════════════
describe('client: getSubscriptions() deprecation', () => {
  beforeEach(() => {
    DeprecationRegistry.reset();
    DeprecationRegistry.unsilence();
  });

  it('emits a deprecation warning when getSubscriptions() is called', async () => {
    const client = makeClient();
    // Mock the underlying fetch so we don't make real network calls
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify([]),
    } as unknown as Response);
    // Patch the global fetch for this call
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const { calls, restore } = captureWarn();
    try {
      await client.getSubscriptions();
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }

    const combined = calls.map((c) => c.join(' ')).join('\n');
    expect(combined).toContain('getSubscriptions');
    expect(combined).toContain('listSubscriptions');
  });

  it('only warns once even if called multiple times', async () => {
    const client = makeClient();
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify([]),
    } as unknown as Response);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const { calls, restore } = captureWarn();
    try {
      await client.getSubscriptions();
      await client.getSubscriptions();
      await client.getSubscriptions();
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }

    const deprecationWarns = calls.filter((c) => c.join(' ').includes('getSubscriptions'));
    expect(deprecationWarns).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 10 — getWebhooks() deprecation warning
// ═════════════════════════════════════════════════════════════════════════════
describe('client: getWebhooks() deprecation', () => {
  beforeEach(() => {
    DeprecationRegistry.reset();
    DeprecationRegistry.unsilence();
  });

  it('emits a deprecation warning when getWebhooks() is called', async () => {
    const client = makeClient();
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify([]),
    } as unknown as Response);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const { calls, restore } = captureWarn();
    try {
      await client.getWebhooks();
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }

    const combined = calls.map((c) => c.join(' ')).join('\n');
    expect(combined).toContain('getWebhooks');
    expect(combined).toContain('listWebhooks');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 11 — getSdkVersion() / getApiVersion()
// ═════════════════════════════════════════════════════════════════════════════
describe('client: version introspection', () => {
  it('getSdkVersion() returns the SDK_VERSION constant', () => {
    const client = makeClient();
    expect(client.getSdkVersion()).toBe(SDK_VERSION);
  });

  it('getApiVersion() returns CURRENT_API_VERSION by default', () => {
    const client = makeClient();
    expect(client.getApiVersion()).toBe(CURRENT_API_VERSION);
  });

  it('getApiVersion() returns the explicitly configured version', () => {
    const client = makeClient({ apiVersion: CURRENT_API_VERSION });
    expect(client.getApiVersion()).toBe(CURRENT_API_VERSION);
  });

  it('SDK_VERSION is a valid semver', () => {
    expect(() => parseSemVer(SDK_VERSION)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 12 — X-SDK-Version header injected
// ═════════════════════════════════════════════════════════════════════════════
describe('client: X-SDK-Version header', () => {
  it('injects X-SDK-Version on every request', async () => {
    const client = makeClient();

    let capturedHeaders: Record<string, string> = {};
    const mockFetch = jest.fn().mockImplementation(((_url: string, init: RequestInit) => {
      capturedHeaders = (init.headers ?? {}) as Record<string, string>;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify([]),
      } as unknown as Response);
    }) as typeof fetch);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      await client.listSubscriptions();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(capturedHeaders['X-SDK-Version']).toBe(SDK_VERSION);
  });

  it('injects X-API-Version matching the configured apiVersion', async () => {
    const client = makeClient({ apiVersion: CURRENT_API_VERSION });

    let capturedHeaders: Record<string, string> = {};
    const mockFetch = jest.fn().mockImplementation(((_url: string, init: RequestInit) => {
      capturedHeaders = (init.headers ?? {}) as Record<string, string>;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify([]),
      } as unknown as Response);
    }) as typeof fetch);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      await client.listSubscriptions();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(capturedHeaders['X-API-Version']).toBe(String(CURRENT_API_VERSION));
  });
});
