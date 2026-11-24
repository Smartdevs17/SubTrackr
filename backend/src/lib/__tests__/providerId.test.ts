/**
 * backend/src/lib/__tests__/providerId.test.ts
 *
 * Unit tests for the provider-ID canonical resolver (issue #2256).
 * Run with: npx jest --config jest.backend.config.js backend/src/lib/__tests__/providerId.test.ts
 */

import {
  canonicalize,
  resolveProviderId,
  isValidProviderId,
  registerProviderIdMapping,
  lookupProviderId,
  lookupCanonicalProviderId,
  clearProviderIdRegistry,
  ProviderIdError,
  type CanonicalId,
  type BillingProvider,
  type ProviderIdKind,
} from '../providerId';

const providers: BillingProvider[] = ['stripe', 'paypal', 'paddle'];
const kinds: ProviderIdKind[] = [
  'customer',
  'subscription',
  'charge',
  'refund',
  'invoice',
  'payout',
];

beforeEach(() => {
  clearProviderIdRegistry();
});

describe('isValidProviderId', () => {
  it('accepts valid Stripe customer IDs', () => {
    expect(isValidProviderId('stripe', 'cus_123abc')).toBe(true);
    expect(isValidProviderId('stripe', 'cus_xyz')).toBe(true);
  });

  it('accepts valid Stripe subscription IDs', () => {
    expect(isValidProviderId('stripe', 'sub_456def')).toBe(true);
  });

  it('accepts valid Stripe charge IDs', () => {
    expect(isValidProviderId('stripe', 'ch_789ghi')).toBe(true);
  });

  it('rejects invalid Stripe IDs', () => {
    expect(isValidProviderId('stripe', 'invalid_id')).toBe(false);
    expect(isValidProviderId('stripe', 'cus_')).toBe(false);
    expect(isValidProviderId('stripe', '')).toBe(false);
  });

  it('accepts valid PayPal IDs', () => {
    expect(isValidProviderId('paypal', 'CUST-123')).toBe(true);
    expect(isValidProviderId('paypal', 'P-123456')).toBe(true);
    expect(isValidProviderId('paypal', 'CAPT-789')).toBe(true);
  });

  it('rejects invalid PayPal IDs', () => {
    expect(isValidProviderId('paypal', 'cus_123')).toBe(false);
    expect(isValidProviderId('paypal', '')).toBe(false);
  });

  it('accepts valid Paddle IDs', () => {
    expect(isValidProviderId('paddle', 'ctm_123')).toBe(true);
    expect(isValidProviderId('paddle', 'sub_456')).toBe(true);
    expect(isValidProviderId('paddle', 'txn_789')).toBe(true);
  });

  it('rejects empty or whitespace IDs for all providers', () => {
    for (const provider of providers) {
      expect(isValidProviderId(provider, '')).toBe(false);
      expect(isValidProviderId(provider, '   ')).toBe(false);
      expect(isValidProviderId(provider, '\t')).toBe(false);
    }
  });
});

describe('canonicalize', () => {
  it('returns a canon:-prefixed ID', () => {
    const id = canonicalize('stripe', 'customer', 'cus_123');
    expect(id).toMatch(/^canon:/);
    expect(id.length).toBeGreaterThan('canon:'.length);
  });

  it('is deterministic — same input yields same canonical ID', () => {
    const a = canonicalize('stripe', 'customer', 'cus_123');
    const b = canonicalize('stripe', 'customer', 'cus_123');
    expect(a).toBe(b);
  });

  it('differs when provider differs', () => {
    const stripe = canonicalize('stripe', 'customer', 'cus_123');
    const paypal = canonicalize('paypal', 'customer', 'CUST-123');
    expect(stripe).not.toBe(paypal);
  });

  it('differs when kind differs', () => {
    const customer = canonicalize('stripe', 'customer', 'cus_123');
    const subscription = canonicalize('stripe', 'subscription', 'cus_123');
    expect(customer).not.toBe(subscription);
  });

  it('differs when providerId differs', () => {
    const a = canonicalize('stripe', 'customer', 'cus_123');
    const b = canonicalize('stripe', 'customer', 'cus_456');
    expect(a).not.toBe(b);
  });

  it('works for all providers and kinds', () => {
    for (const provider of providers) {
      for (const kind of kinds) {
        const providerId =
          provider === 'stripe'
            ? `cus_${kind}_${provider}`
            : provider === 'paypal'
              ? `CUST-${kind}-${provider}`
              : `ctm_${kind}_${provider}`;
        const id = canonicalize(provider, kind, providerId);
        expect(id).toMatch(/^canon:/);
      }
    }
  });

  it('throws ProviderIdError for unknown provider', () => {
    let error: unknown;
    try {
      canonicalize('unknown' as BillingProvider, 'customer', 'cus_123');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ProviderIdError);
    expect((error as ProviderIdError).code).toBe('INVALID_PROVIDER');
  });

  it('throws ProviderIdError for invalid provider ID', () => {
    let error: unknown;
    try {
      canonicalize('stripe', 'customer', 'not_a_stripe_id');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ProviderIdError);
    expect((error as ProviderIdError).code).toBe('INVALID_PROVIDER_ID');
  });

  it('throws ProviderIdError for unknown kind', () => {
    let error: unknown;
    try {
      canonicalize('stripe', 'unknown_kind' as ProviderIdKind, 'cus_123');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ProviderIdError);
    expect((error as ProviderIdError).code).toBe('UNSUPPORTED_KIND');
  });

  it('is case-sensitive for provider ID', () => {
    const lower = canonicalize('stripe', 'customer', 'cus_abc');
    const upper = canonicalize('stripe', 'customer', 'cus_ABC');
    expect(lower).not.toBe(upper);
  });
});

describe('resolveProviderId', () => {
  it('returns a full resolution object', () => {
    const result = resolveProviderId('stripe', 'customer', 'cus_123');
    expect(result.provider).toBe('stripe');
    expect(result.kind).toBe('customer');
    expect(result.providerId).toBe('cus_123');
    expect(result.canonicalId).toMatch(/^canon:/);
  });

  it('throws ProviderIdError on invalid input', () => {
    expect(() => resolveProviderId('stripe', 'customer', 'invalid')).toThrow(
      ProviderIdError
    );
  });
});

describe('registerProviderIdMapping / lookupProviderId', () => {
  it('registers and looks up a mapping', () => {
    const canonical = canonicalize('stripe', 'customer', 'cus_123');
    registerProviderIdMapping({
      canonicalId: canonical,
      provider: 'stripe',
      kind: 'customer',
      providerId: 'cus_123',
    });

    const found = lookupProviderId(canonical, 'stripe', 'customer');
    expect(found).toBe('cus_123');
  });

  it('returns null for unregistered canonical ID', () => {
    const canonical = canonicalize('stripe', 'customer', 'cus_123');
    const found = lookupProviderId(canonical, 'stripe', 'customer');
    expect(found).toBe(null);
  });

  it('returns null when provider does not match', () => {
    const canonical = canonicalize('stripe', 'customer', 'cus_123');
    registerProviderIdMapping({
      canonicalId: canonical,
      provider: 'stripe',
      kind: 'customer',
      providerId: 'cus_123',
    });
    const found = lookupProviderId(canonical, 'paypal', 'customer');
    expect(found).toBe(null);
  });

  it('returns null when kind does not match', () => {
    const canonical = canonicalize('stripe', 'customer', 'cus_123');
    registerProviderIdMapping({
      canonicalId: canonical,
      provider: 'stripe',
      kind: 'customer',
      providerId: 'cus_123',
    });
    const found = lookupProviderId(canonical, 'stripe', 'subscription');
    expect(found).toBe(null);
  });

  it('throws MAPPING_CONFLICT on conflicting registration', () => {
    const canonical = canonicalize('stripe', 'customer', 'cus_123');
    registerProviderIdMapping({
      canonicalId: canonical,
      provider: 'stripe',
      kind: 'customer',
      providerId: 'cus_123',
    });
    let error: unknown;
    try {
      registerProviderIdMapping({
        canonicalId: canonical,
        provider: 'stripe',
        kind: 'customer',
        providerId: 'cus_999',
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ProviderIdError);
    expect((error as ProviderIdError).code).toBe('MAPPING_CONFLICT');
  });

  it('allows identical re-registration without error', () => {
    const canonical = canonicalize('stripe', 'customer', 'cus_123');
    registerProviderIdMapping({
      canonicalId: canonical,
      provider: 'stripe',
      kind: 'customer',
      providerId: 'cus_123',
    });
    expect(() =>
      registerProviderIdMapping({
        canonicalId: canonical,
        provider: 'stripe',
        kind: 'customer',
        providerId: 'cus_123',
      })
    ).not.toThrow();
  });
});

describe('lookupCanonicalProviderId', () => {
  it('returns null for unregistered provider ID', () => {
    const found = lookupCanonicalProviderId('stripe', 'customer', 'cus_123');
    expect(found).toBe(null);
  });

  it('returns canonical ID after registration', () => {
    const canonical = canonicalize('stripe', 'customer', 'cus_123');
    registerProviderIdMapping({
      canonicalId: canonical,
      provider: 'stripe',
      kind: 'customer',
      providerId: 'cus_123',
    });
    const found = lookupCanonicalProviderId('stripe', 'customer', 'cus_123');
    expect(found).toBe(canonical);
  });
});

describe('clearProviderIdRegistry', () => {
  it('clears all mappings', () => {
    const canonical = canonicalize('stripe', 'customer', 'cus_123');
    registerProviderIdMapping({
      canonicalId: canonical,
      provider: 'stripe',
      kind: 'customer',
      providerId: 'cus_123',
    });
    expect(lookupProviderId(canonical, 'stripe', 'customer')).toBe('cus_123');

    clearProviderIdRegistry();
    expect(lookupProviderId(canonical, 'stripe', 'customer')).toBe(null);
  });
});

describe('canonicalId branding', () => {
  it('canonicalize returns a CanonicalId-branded string', () => {
    const id = canonicalize('stripe', 'customer', 'cus_123');
    expect(typeof id).toBe('string');
    // CanonicalId is a branded type; at runtime it's just a string.
    expect(id.startsWith('canon:')).toBe(true);
  });
});
