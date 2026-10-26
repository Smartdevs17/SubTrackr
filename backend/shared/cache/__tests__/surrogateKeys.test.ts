import { describe, it, expect } from '@jest/globals';
import { SURROGATE_KEY, scopedSurrogateKey, formatSurrogateKeyHeader } from '../surrogateKeys';

describe('surrogateKeys', () => {
  it('defines all required resource types', () => {
    expect(SURROGATE_KEY.PLAN).toBe('plan');
    expect(SURROGATE_KEY.PRICING).toBe('pricing');
    expect(SURROGATE_KEY.FEATURE).toBe('feature');
    expect(SURROGATE_KEY.CONFIG).toBe('config');
    expect(SURROGATE_KEY.USER).toBe('user');
  });

  it('builds scoped keys', () => {
    expect(scopedSurrogateKey('plan', 'premium')).toBe('plan:premium');
  });

  it('formats header with deduplication', () => {
    expect(formatSurrogateKeyHeader(['plan', 'plan', 'pricing'])).toBe('plan pricing');
  });

  it('filters empty keys', () => {
    expect(formatSurrogateKeyHeader(['plan', '', 'pricing'])).toBe('plan pricing');
  });
});
