import { QueryCache } from '../queryCache';

describe('QueryCache', () => {
  let clock: number;
  let cache: QueryCache;
  const evicted: string[] = [];

  beforeEach(() => {
    clock = 1_000;
    evicted.length = 0;
    cache = new QueryCache({ now: () => clock, maxEntries: 2, onEvict: (key) => evicted.push(key) });
  });

  it('expires entries at their TTL', () => {
    cache.set(['subscriptions', 'list'], ['a'], { ttlMs: 100 });
    expect(cache.get<string[]>('["subscriptions","list"]')?.data).toEqual(['a']);

    clock += 101;
    expect(cache.get('["subscriptions","list"]')).toBeUndefined();
    expect(evicted).toContain('["subscriptions","list"]');
  });

  it('evicts the least recently used entry beyond maxEntries', () => {
    cache.set(['a'], 1, { ttlMs: 1_000 });
    cache.set(['b'], 2, { ttlMs: 1_000 });
    cache.get('["a"]');
    cache.set(['c'], 3, { ttlMs: 1_000 });

    expect(cache.get('["a"]')?.data).toBe(1);
    expect(cache.get('["b"]')).toBeUndefined();
    expect(cache.get('["c"]')?.data).toBe(3);
  });

  it('invalidates by predicate and returns removed serialised keys', () => {
    cache.set(['subscriptions', 'list'], [1], { ttlMs: 1_000, tags: ['subscriptions'] });
    cache.set(['invoices'], [2], { ttlMs: 1_000, tags: ['invoices'] });

    const removed = cache.invalidate((entry) => entry.tags.includes('subscriptions'));

    expect(removed).toEqual(['["subscriptions","list"]']);
    expect(cache.get('["subscriptions","list"]')).toBeUndefined();
    expect(cache.get('["invoices"]')?.data).toEqual([2]);
  });

  it('clears every entry', () => {
    cache.set(['a'], 1, { ttlMs: 1_000 });
    cache.set(['b'], 2, { ttlMs: 1_000 });
    expect(cache.clear()).toHaveLength(2);
    expect(cache.size).toBe(0);
  });
});
