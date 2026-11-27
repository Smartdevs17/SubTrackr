/**
 * packages/billing-types/src/__tests__/index.test.ts
 *
 * Pins the shared canonical-id vocabulary used by the resolver.
 */

import {
  CANONICAL_ID_VERSION,
  CANONICAL_ID_PATTERN,
  CANONICAL_ID_PATTERN_SOURCE,
  KNOWN_PROVIDERS,
  MAX_NORMALIZED_ID_LENGTH,
  DEFAULT_ALLOW_CUSTOM_PROVIDERS,
  PROVIDER_PREFIXES,
  PROVIDER_ID_ERROR_CODES,
} from '../index';

describe('@subtrackr/billing-types', () => {
  it('publishes a stable wire-format version and limits', () => {
    expect(CANONICAL_ID_VERSION).toBe('1');
    expect(MAX_NORMALIZED_ID_LENGTH).toBe(128);
    expect(DEFAULT_ALLOW_CUSTOM_PROVIDERS).toBe(true);
  });

  it('exposes the built-in providers', () => {
    expect(KNOWN_PROVIDERS).toHaveLength(6);
    expect(KNOWN_PROVIDERS).toContain('stripe');
    expect(KNOWN_PROVIDERS).toContain('paypal');
    expect(Object.isFrozen(KNOWN_PROVIDERS)).toBe(true);
  });

  it('matches canonical ids and rejects malformed ones', () => {
    expect(CANONICAL_ID_PATTERN.test('stripe:abc-a1b2c3d4')).toBe(true);
    expect(CANONICAL_ID_PATTERN.test('paypal:pay-99-0f0f0f0f')).toBe(true);
    expect(CANONICAL_ID_PATTERN.test('stripe:ABC-a1b2c3d4')).toBe(false);
    expect(CANONICAL_ID_PATTERN.test('stripe:abc')).toBe(false);
    expect(CANONICAL_ID_PATTERN.test('nocolon-a1b2c3d4')).toBe(false);
    expect(CANONICAL_ID_PATTERN_SOURCE).toContain('[0-9a-f]{8}');
  });

  it('shares provider prefix defaults', () => {
    expect(PROVIDER_PREFIXES['stripe']).toContain('cus');
    expect(PROVIDER_PREFIXES['paypal']).toContain('pay');
    expect(Object.isFrozen(PROVIDER_PREFIXES)).toBe(true);
  });

  it('shares the stable error-code vocabulary', () => {
    expect(PROVIDER_ID_ERROR_CODES.INVALID_INPUT).toBe('INVALID_INPUT');
    expect(PROVIDER_ID_ERROR_CODES.UNKNOWN_PROVIDER).toBe('UNKNOWN_PROVIDER');
    expect(PROVIDER_ID_ERROR_CODES.EXTERNAL_ID_TOO_LONG).toBe('EXTERNAL_ID_TOO_LONG');
  });
});
