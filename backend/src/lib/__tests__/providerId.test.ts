/**
 * backend/src/lib/__tests__/providerId.test.ts
 *
 * Unit tests for the stable canonical provider-id resolver (issue #2256).
 * Every documented behaviour — normalisation, determinism, collision
 * resistance, validation, error codes and observability — is pinned here.
 */

import {
  ProviderIdErrorCode,
  ProviderIdError,
  DEFAULT_CANONICAL_ID_CONFIG,
  validateCanonicalIdConfig,
  parseProviderIdentifier,
  normalizeExternalId,
  fnv1a32,
  canonicalizeProviderId,
  resolveProviderId,
  areSameProviderId,
  createCanonicalIdResolver,
  noopCanonicalIdMetrics,
  noopCanonicalIdLogger,
} from '../providerId';
import {
  CANONICAL_ID_PATTERN,
  CANONICAL_ID_VERSION,
  KNOWN_PROVIDERS,
  MAX_NORMALIZED_ID_LENGTH,
} from '../../../../packages/billing-types/src/index';

/** Assert that `fn` throws a ProviderIdError carrying the expected stable code. */
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
    expect(ProviderIdErrorCode.INVALID_CONFIG).toBe('INVALID_CONFIG');
    expect(ProviderIdErrorCode.INVALID_INPUT).toBe('INVALID_INPUT');
    expect(ProviderIdErrorCode.INVALID_FORMAT).toBe('INVALID_FORMAT');
    expect(ProviderIdErrorCode.INVALID_PROVIDER).toBe('INVALID_PROVIDER');
    expect(ProviderIdErrorCode.UNKNOWN_PROVIDER).toBe('UNKNOWN_PROVIDER');
    expect(ProviderIdErrorCode.INVALID_EXTERNAL_ID).toBe('INVALID_EXTERNAL_ID');
    expect(ProviderIdErrorCode.EXTERNAL_ID_TOO_LONG).toBe('EXTERNAL_ID_TOO_LONG');
    expect(ProviderIdErrorCode.INVALID_CANONICAL_ID).toBe('INVALID_CANONICAL_ID');
  });

  it('builds a typed ProviderIdError with code and details', () => {
    const error = new ProviderIdError(ProviderIdErrorCode.INVALID_PROVIDER, 'bad provider', {
      provider: 'x!',
    });
    expect(error instanceof Error).toBe(true);
    expect(error instanceof ProviderIdError).toBe(true);
    expect(error.name).toBe('ProviderIdError');
    expect(error.code).toBe('INVALID_PROVIDER');
    expect(error.message).toBe('bad provider');
    expect(error.details).toEqual({ provider: 'x!' });
  });

  it('exposes the shared defaults', () => {
    expect(CANONICAL_ID_VERSION).toBe('1');
    expect(MAX_NORMALIZED_ID_LENGTH).toBe(128);
    expect(DEFAULT_CANONICAL_ID_CONFIG.maxNormalizedLength).toBe(128);
    expect(DEFAULT_CANONICAL_ID_CONFIG.allowCustomProviders).toBe(true);
    expect(DEFAULT_CANONICAL_ID_CONFIG.knownProviders).toEqual(KNOWN_PROVIDERS);
    expect(CANONICAL_ID_PATTERN.test('stripe:abc-a1b2c3d4')).toBe(true);
  });

  it('computes a deterministic 32-bit FNV-1a hash', () => {
    expect(fnv1a32('provider\u0000id')).toBe(fnv1a32('provider\u0000id'));
    expect(fnv1a32('a')).not.toBe(fnv1a32('b'));
    expect(fnv1a32('x') >= 0).toBe(true);
  });
});

describe('validateCanonicalIdConfig', () => {
  it('fills in documented defaults', () => {
    const config = validateCanonicalIdConfig({});
    expect(config.maxNormalizedLength).toBe(128);
    expect(config.allowCustomProviders).toBe(true);
    expect(config.knownProviders).toContain('stripe');
  });

  it('normalises and de-duplicates provider names', () => {
    const config = validateCanonicalIdConfig({
      knownProviders: ['Stripe', 'stripe', 'PAYPAL'],
    });
    expect(config.knownProviders).toHaveLength(2);
    expect(config.knownProviders).toContain('paypal');
    expect(config.knownProviders).toContain('stripe');
  });

  it('rejects invalid configuration', () => {
    expectCode(() => validateCanonicalIdConfig({ maxNormalizedLength: 0 }), 'INVALID_CONFIG');
    expectCode(() => validateCanonicalIdConfig({ allowCustomProviders: 'yes' }), 'INVALID_CONFIG');
    expectCode(() => validateCanonicalIdConfig({ knownProviders: [] }), 'INVALID_CONFIG');
    expectCode(() => validateCanonicalIdConfig({ providerPrefixes: 'no' }), 'INVALID_CONFIG');
  });
});

describe('parseProviderIdentifier', () => {
  it('parses a "provider:externalId" string', () => {
    expect(parseProviderIdentifier('  Stripe :  cus_AbC  ')).toEqual({
      provider: 'Stripe ',
      externalId: '  cus_AbC',
    });
  });

  it('parses a ProviderIdentifier object', () => {
    expect(parseProviderIdentifier({ provider: 'paypal', externalId: 'PAY-1' })).toEqual({
      provider: 'paypal',
      externalId: 'PAY-1',
    });
  });

  it('rejects malformed shapes', () => {
    expectCode(() => parseProviderIdentifier('no-separator'), 'INVALID_FORMAT');
    expectCode(() => parseProviderIdentifier('stripe:'), 'INVALID_FORMAT');
    expectCode(() => parseProviderIdentifier({ provider: 'stripe' }), 'INVALID_INPUT');
    expectCode(() => parseProviderIdentifier(null), 'INVALID_INPUT');
    expectCode(() => parseProviderIdentifier(42), 'INVALID_INPUT');
  });
});

describe('normalizeExternalId', () => {
  it('trims, lower-cases and collapses separators', () => {
    expect(normalizeExternalId('  AbC__12--34  ')).toBe('abc-12-34');
    expect(normalizeExternalId('A/B/C')).toBe('a-b-c');
    expect(normalizeExternalId('---lead+trail---')).toBe('lead-trail');
  });

  it('strips provider-specific prefixes', () => {
    expect(normalizeExternalId('cus_AbC123', 'stripe')).toBe('abc123');
    expect(normalizeExternalId('PAY-99', 'paypal')).toBe('99');
    expect(normalizeExternalId('cus_AbC123', 'paypal')).toBe('cus-abc123');
  });

  it('Unicode-normalises before folding', () => {
    expect(normalizeExternalId('ﬁle-01')).toBe('file-01');
  });

  it('rejects empty and non-alphanumeric identifiers', () => {
    expectCode(() => normalizeExternalId(''), 'INVALID_EXTERNAL_ID');
    expectCode(() => normalizeExternalId('   '), 'INVALID_EXTERNAL_ID');
    expectCode(() => normalizeExternalId('---___'), 'INVALID_EXTERNAL_ID');
    expectCode(() => normalizeExternalId(123), 'INVALID_EXTERNAL_ID');
  });

  it('bounds identifier length', () => {
    const tooLong = 'a'.repeat(129);
    expectCode(() => normalizeExternalId(tooLong), 'EXTERNAL_ID_TOO_LONG');
    expectCode(() => normalizeExternalId('a'.repeat(600)), 'EXTERNAL_ID_TOO_LONG');
  });
});

describe('canonicalizeProviderId', () => {
  it('is deterministic and well-formed', () => {
    const a = canonicalizeProviderId({ provider: 'stripe', externalId: 'cus_AbC-12' });
    const b = canonicalizeProviderId({ provider: 'stripe', externalId: 'cus_AbC-12' });
    expect(a).toBe(b);
    expect(CANONICAL_ID_PATTERN.test(a)).toBe(true);
    expect(a.slice(0, 7)).toBe('stripe:');
    expect(a.slice(-9)).toBe(`-${a.slice(-8)}`);
  });

  it('is invariant to case, separators and provider prefixes', () => {
    const a = canonicalizeProviderId('stripe:cus_AbC-12');
    const b = canonicalizeProviderId({ provider: 'STRIPE', externalId: ' CUS abc 12 ' });
    expect(a).toBe(b);
  });

  it('keeps different providers and identities distinct', () => {
    const stripe = canonicalizeProviderId({ provider: 'stripe', externalId: 'abc' });
    const paypal = canonicalizeProviderId({ provider: 'paypal', externalId: 'abc' });
    expect(stripe).not.toBe(paypal);
    expect(stripe.slice(-8)).not.toBe(paypal.slice(-8));
  });

  it('folds Unicode deterministically and keeps distinct ids hash-distinct', () => {
    const latin = canonicalizeProviderId({ provider: 'custom', externalId: 'cafe' });
    const accented = canonicalizeProviderId({ provider: 'custom', externalId: 'café' });
    expect(latin).toBe(accented);
    const other = canonicalizeProviderId({ provider: 'custom', externalId: 'cafes' });
    expect(other).not.toBe(latin);
    expect(other.slice(-8)).not.toBe(latin.slice(-8));
  });

  it('passes already-canonical strings through unchanged', () => {
    const canonical = canonicalizeProviderId({ provider: 'stripe', externalId: 'abc' });
    expect(canonicalizeProviderId(canonical)).toBe(canonical);
    expect(canonicalizeProviderId(canonical.toUpperCase())).toBe(canonical);
  });

  it('emits every documented failure code', () => {
    expectCode(() => canonicalizeProviderId({ provider: 'a!', externalId: 'x' }), 'INVALID_PROVIDER');
    expectCode(() => canonicalizeProviderId({ provider: '', externalId: 'x' }), 'INVALID_PROVIDER');
    expectCode(() => canonicalizeProviderId({ provider: 'x', externalId: '' }), 'INVALID_EXTERNAL_ID');
    expectCode(() => canonicalizeProviderId('stripe:cus_'), 'INVALID_EXTERNAL_ID');
    expectCode(() => canonicalizeProviderId({ provider: 'stripe', externalId: 'a'.repeat(600) }), 'EXTERNAL_ID_TOO_LONG');
    expectCode(
      () => canonicalizeProviderId({ provider: 'unknown', externalId: 'x' }, { allowCustomProviders: false }),
      'UNKNOWN_PROVIDER'
    );
  });

  it('accepts custom providers by default and honours the allow-list', () => {
    const custom = canonicalizeProviderId({ provider: 'my_saas', externalId: 'ID-1' });
    expect(CANONICAL_ID_PATTERN.test(custom)).toBe(true);
    expect(custom.slice(0, 8)).toBe('my_saas:');
    expect(canonicalizeProviderId({ provider: 'my_saas', externalId: 'ID-1' }, {
      allowCustomProviders: true,
      knownProviders: ['my_saas'],
    })).toBe(custom);
  });
});

describe('resolveProviderId', () => {
  it('returns the full resolution record', () => {
    const result = resolveProviderId({ provider: 'Stripe', externalId: ' cus_AbC ' });
    expect(result.provider).toBe('stripe');
    expect(result.normalizedId).toBe('abc');
    expect(result.hash).toHaveLength(8);
    expect(result.canonicalId).toBe(`stripe:abc-${result.hash}`);
    expect(result.version).toBe('1');
    expect(result.alreadyCanonical).toBe(false);
    expect(result.source).toEqual({ provider: 'stripe', externalId: ' cus_AbC ' });
  });

  it('marks canonical inputs as already canonical', () => {
    const canonical = canonicalizeProviderId({ provider: 'paypal', externalId: 'PAY-7' });
    const result = resolveProviderId(canonical);
    expect(result.alreadyCanonical).toBe(true);
    expect(result.canonicalId).toBe(canonical);
    expect(result.hash).toHaveLength(8);
  });
});

describe('areSameProviderId', () => {
  it('matches identifiers across representations', () => {
    expect(areSameProviderId(
      { provider: 'stripe', externalId: 'cus_AbC' },
      'STRIPE:ABC'
    )).toBe(true);
  });

  it('distinguishes providers and canonical ids', () => {
    expect(areSameProviderId(
      { provider: 'stripe', externalId: 'abc' },
      { provider: 'paypal', externalId: 'abc' }
    )).toBe(false);
    const a = canonicalizeProviderId({ provider: 'stripe', externalId: 'abc' });
    const b = canonicalizeProviderId({ provider: 'stripe', externalId: 'abd' });
    expect(areSameProviderId(a, b)).toBe(false);
  });
});

describe('createCanonicalIdResolver', () => {
  it('wires metrics and logger hooks on success', () => {
    const events: string[] = [];
    const resolver = createCanonicalIdResolver(
      {},
      {
        recordCanonicalized: () => events.push('canonicalized'),
        recordResolved: () => events.push('resolved'),
        recordComparison: () => events.push('compared'),
        recordRejected: () => events.push('rejected'),
      },
      {
        info: () => events.push('info'),
        warn: () => events.push('warn'),
      }
    );
    resolver.canonicalize({ provider: 'stripe', externalId: 'cus_1' });
    resolver.resolve({ provider: 'stripe', externalId: 'cus_1' });
    resolver.areSame('stripe:cus_1', { provider: 'stripe', externalId: '1' });
    resolver.normalize('cus_ABC', 'stripe');
    expect(events).toContain('canonicalized');
    expect(events).toContain('resolved');
    expect(events).toContain('compared');
    expect(events).toContain('info');
    expect(events).not.toContain('rejected');
    expect(events).not.toContain('warn');
  });

  it('records and rethrows rejected inputs', () => {
    let rejectedCode = '';
    let warned = false;
    const resolver = createCanonicalIdResolver(
      {},
      { recordRejected: (_operation: string, code: string) => { rejectedCode = code; } },
      { warn: () => { warned = true; } }
    );
    expect(() => resolver.canonicalize({ provider: '', externalId: 'x' })).toThrow();
    expect(rejectedCode).toBe('INVALID_PROVIDER');
    expect(warned).toBe(true);
  });

  it('applies configuration to every method', () => {
    const resolver = createCanonicalIdResolver({
      allowCustomProviders: false,
      knownProviders: ['stripe'],
    });
    expect(resolver.canonicalize({ provider: 'stripe', externalId: 'CUS-1' })).toContain('stripe:');
    expect(() => resolver.canonicalize({ provider: 'other', externalId: '1' })).toThrow();
    expect(resolver.normalize('cus_1', 'stripe')).toBe('1');
  });

  it('exposes safe no-op sinks', () => {
    expect(() => noopCanonicalIdMetrics.recordComparison(true)).not.toThrow();
    expect(() => noopCanonicalIdLogger.info('x', {})).not.toThrow();
  });
});
